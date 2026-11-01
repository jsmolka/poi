import { clamp, lerp } from '@/utils/numeric';
import { TileLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Popup } from 'mapbox-gl';

// Must match what the worker assumes: tiles are 512px, so tile zoom == map zoom.
const TILE_SIZE = 512;
// Tiles at this zoom (and when overzooming past it) are sent at full detail.
// Lower it if tiles get heavy in dense areas.
const MAX_ZOOM = 14;

// Default popup body: layer id + clicked coordinates. Return a string (rendered as text),
// an HTMLElement (rendered as DOM), or null (no popup).
const defaultGetPopup = (info) => {
  const [lng, lat] = info.coordinate ?? [];
  return `${info.layer.id}\n${lat?.toFixed(5)}, ${lng?.toFixed(5)}`;
};

export function useDeck(map) {
  const layers = new Map();
  const cleanups = new Map();

  // ---- popup + cursor ---------------------------------------------------------

  const popupContent = new Map(); // layer id -> getPopup(info)
  const popup = new Popup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: '280px',
    offset: 6,
  });
  let popupLayerId = null;
  popup.on('close', () => {
    popupLayerId = null;
  });

  // POIs: snap the popup to the point itself. Ways (and fallback): use the click location.
  const popupLngLat = (info) => {
    const attr = info.sourceLayer?.props.data?.attributes?.getPosition;
    if (attr && info.index >= 0) {
      return [attr.value[2 * info.index], attr.value[2 * info.index + 1]];
    }
    return info.coordinate;
  };

  const showPopup = (info, getPopup) => {
    const content = getPopup(info);
    const lngLat = popupLngLat(info);
    if (content == null || !lngLat) {
      popup.remove();
      return;
    }

    popup.setLngLat(lngLat);
    if (typeof content === 'string') {
      popup.setText(content);
    } else {
      popup.setDOMContent(content);
    }
    popup.addTo(map);
    popupLayerId = info.layer.id; // after addTo: re-adding fires 'close', which resets this
  };

  // Single source of truth for the cursor. Deck also writes the cursor on pointer events, so we
  // hand it this same state via getCursor (below) and mirror it on the canvas: both always agree.
  const HOVER_RELEASE_MS = 80; // ignore one-frame pick misses (thin lines, tiles refining)
  let hovering = false;
  let releaseTimer = null;

  const applyCursor = () => {
    const canvas = map.getCanvas();
    const cursor = hovering ? 'pointer' : '';
    if (canvas.style.cursor !== cursor) {
      canvas.style.cursor = cursor;
    }
  };

  const setHovering = (on) => {
    if (on) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
      if (!hovering) {
        hovering = true;
        applyCursor();
      }
      return;
    }
    if (!hovering || releaseTimer != null) {
      return;
    }
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      hovering = false;
      applyCursor();
    }, HOVER_RELEASE_MS);
  };

  const resetHovering = () => {
    clearTimeout(releaseTimer);
    releaseTimer = null;
    hovering = false;
    applyCursor();
  };

  // popupLngLat and showPopup stay exactly as before

  const overlay = new MapboxOverlay({
    interleaved: true,
    getCursor: ({ isDragging }) => (hovering && !isDragging ? 'pointer' : ''),
    onHover: (info) => {
      setHovering(Boolean(info.picked && popupContent.has(info.layer?.id)));
    },
    onClick: (info) => {
      const getPopup = info.picked ? popupContent.get(info.layer?.id) : null;
      if (getPopup) {
        showPopup(info, getPopup);
      } else {
        popup.remove();
      }
    },
  });

  map.addControl(overlay);

  // Hover events stop while dragging or when the mouse leaves the map, so don't leave the pointer stuck.
  map.on('dragstart', resetHovering);
  map.on('mouseout', resetHovering);

  // ---- layer management -------------------------------------------------------

  const addLayer = (layer, cleanup) => {
    removeLayer(layer.id);

    layers.set(layer.id, layer);
    cleanups.set(layer.id, cleanup);

    syncLayers();
  };

  const removeLayer = (id) => {
    if (!layers.has(id)) {
      return;
    }

    layers.delete(id);
    cleanups.get(id)?.();
    cleanups.delete(id);

    popupContent.delete(id);
    if (popupLayerId === id) {
      popup.remove();
    }
    resetHovering();

    syncLayers();
  };

  const updateLayer = (layer) => {
    layers.set(layer.id, layer);

    syncLayers();
  };

  const syncLayers = () => {
    overlay.setProps({ layers: Array.from(layers.values()) });
  };

  const scale = () => {
    const minZoom = 6;
    const maxZoom = 18;
    const minSize = 0.5;
    const maxSize = 8;
    return lerp(minSize, maxSize, clamp((map.getZoom() - minZoom) / (maxZoom - minZoom), 0, 1));
  };

  // ---- worker plumbing ------------------------------------------------------

  const worker = new Worker(new URL('./spatial.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextReq = 0;
  let nextKey = 0;

  worker.onmessage = ({ data }) => {
    const resolve = pending.get(data.id);
    if (resolve) {
      pending.delete(data.id);
      resolve(data);
    }
  };

  const requestTile = (key, bbox, zoom, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const id = nextReq++;
      pending.set(id, resolve);
      signal?.addEventListener(
        'abort',
        () => {
          if (pending.delete(id)) {
            reject(new DOMException('Aborted', 'AbortError'));
          }
        },
        { once: true },
      );

      worker.postMessage({
        type: 'tile',
        key,
        id,
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        size: TILE_SIZE,
        zoom,
        maxZoom: MAX_ZOOM,
      });
    });

  // ---- shared tiled-layer helper ---------------------------------------------

  const addTiledLayer = ({ id, beforeId, getPopup, init, transfer, toData, renderTile }) => {
    // unique per registration so a re-add with the same id can't touch the new dataset
    const key = `${id}#${nextKey++}`;
    worker.postMessage({ type: 'init', key, ...init }, transfer);

    // Size is quantised so the layer is only rebuilt when it visibly changes.
    const quantisedScale = () => Math.round(scale() * 10) / 10;
    let size = quantisedScale();

    const makeLayer = () =>
      new TileLayer({
        id,
        beforeId,
        pickable: true,
        tileSize: TILE_SIZE,
        minZoom: 0,
        maxZoom: MAX_ZOOM,
        maxRequests: 3, // tiles that scroll out of view before they're requested never reach the worker
        refinementStrategy: 'best-available', // keep showing parent/child tiles while new ones load
        getTileData: async ({ bbox, index, signal }) =>
          toData(await requestTile(key, bbox, index.z, signal)),
        renderSubLayers: (props) => (props.data ? renderTile(props, size) : null),
        // Changing this regenerates the sublayers from the cached tile data (no refetch).
        updateTriggers: { renderSubLayers: [size] },
      });

    const onZoom = () => {
      const next = quantisedScale();
      if (next !== size) {
        size = next;
        updateLayer(makeLayer());
      }
    };

    map.on('zoom', onZoom);
    addLayer(makeLayer(), () => {
      map.off('zoom', onZoom);
      worker.postMessage({ type: 'dispose', key });
    });

    // Register after addLayer: addLayer -> removeLayer(id) clears any previous handler for this id.
    popupContent.set(id, getPopup);
  };

  // ---- public API -------------------------------------------------------------

  const addLayerPoi = (id, polyline, color, beforeId = undefined, getPopup = defaultGetPopup) => {
    const positions = Float32Array.from(polyline); // copy: the buffer is transferred away

    addTiledLayer({
      id,
      beforeId,
      getPopup,
      init: { kind: 'poi', positions },
      transfer: [positions.buffer],
      toData: ({ positions }) =>
        positions == null
          ? null
          : {
              length: positions.length / 2,
              attributes: {
                getPosition: { value: positions, size: 2 },
              },
            },
      renderTile: (props, scale) =>
        new ScatterplotLayer({
          id: props.id,
          data: props.data,
          getFillColor: [color.r, color.g, color.b, 0xff],
          getRadius: 2,
          radiusUnits: 'pixels',
          radiusScale: scale,
          pickable: true,
        }),
    });
  };

  const addLayerWay = (id, polylines, color, beforeId = undefined, getPopup = defaultGetPopup) => {
    let total = 0;

    const starts = new Uint32Array(polylines.length + 1);
    for (const [i, polyline] of polylines.entries()) {
      starts[i] = total;
      total += polyline.length / 2;
    }
    starts[polylines.length] = total;

    const positions = new Float32Array(2 * total);
    for (const [i, polyline] of polylines.entries()) {
      positions.set(polyline, 2 * starts[i]);
    }

    addTiledLayer({
      id,
      beforeId,
      getPopup,
      init: { kind: 'way', positions, starts },
      transfer: [positions.buffer, starts.buffer],
      toData: ({ positions, startIndices }) =>
        positions == null
          ? null
          : {
              startIndices,
              length: startIndices.length,
              attributes: { getPath: { value: positions, size: 2 } },
            },
      renderTile: (props, scale) =>
        new PathLayer({
          id: props.id,
          data: props.data,
          getColor: [color.r, color.g, color.b, 0xff],
          getWidth: 1,
          widthUnits: 'pixels',
          widthScale: scale,
          jointRounded: true,
          capRounded: true,
          pickable: true,
          _pathType: 'open', // tile pieces are clipped open polylines; skips loop detection
        }),
    });
  };

  return {
    addLayerPoi,
    addLayerWay,
    removeLayer,
  };
}
