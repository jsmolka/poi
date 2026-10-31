import { clamp, lerp } from '@/utils/numeric';
import { TileLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';

// Must match what the worker assumes: tiles are 512px, so tile zoom == map zoom.
const TILE_SIZE = 512;
// Tiles at this zoom (and when overzooming past it) are sent at full detail.
// Lower it if tiles get heavy in dense areas.
const MAX_ZOOM = 14;

export function useDeck(map) {
  const overlay = new MapboxOverlay({ interleaved: true });

  map.addControl(overlay);

  const layers = new Map();
  const cleanups = new Map();

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
    const resolve = pending.get(data.reqId);
    if (resolve) {
      pending.delete(data.reqId);
      resolve(data);
    }
  };

  const requestTile = (key, bbox, z, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const reqId = nextReq++;
      pending.set(reqId, resolve);
      signal?.addEventListener(
        'abort',
        () => {
          if (pending.delete(reqId)) {
            reject(new DOMException('Aborted', 'AbortError'));
          }
        },
        { once: true },
      );

      worker.postMessage({
        type: 'tile',
        key,
        reqId,
        z,
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        tileSize: TILE_SIZE,
        maxZoom: MAX_ZOOM,
      });
    });

  // ---- shared tiled-layer helper ---------------------------------------------

  const addTiledLayer = ({ id, beforeId, init, transfer, toData, renderTile }) => {
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
        pickable: false,
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
  };

  // ---- public API -------------------------------------------------------------

  const addLayerPoi = (id, polyline, color, beforeId = undefined) => {
    const positions = Float32Array.from(polyline); // copy: the buffer is transferred away

    addTiledLayer({
      id,
      beforeId,
      init: { kind: 'poi', positions },
      transfer: [positions.buffer],
      toData: ({ length, positions }) =>
        length === 0
          ? null
          : { length, attributes: { getPosition: { value: positions, size: 2 } } },
      renderTile: (props, size) =>
        new ScatterplotLayer({
          id: props.id,
          data: props.data,
          getFillColor: [color.r, color.g, color.b, 0xff],
          getRadius: 2,
          radiusUnits: 'pixels',
          radiusScale: size,
          pickable: false,
        }),
    });
  };

  const addLayerWay = (id, polylines, color, beforeId = undefined) => {
    // Flatten once: one coordinate buffer + per-way vertex offsets (transferred to the worker).
    const starts = new Uint32Array(polylines.length + 1);
    let total = 0;
    for (let i = 0; i < polylines.length; i++) {
      starts[i] = total;
      total += polylines[i].length / 2;
    }
    starts[polylines.length] = total;

    const positions = new Float32Array(total * 2);
    for (let i = 0; i < polylines.length; i++) {
      positions.set(polylines[i], starts[i] * 2);
    }

    addTiledLayer({
      id,
      beforeId,
      init: { kind: 'way', positions, starts },
      transfer: [positions.buffer, starts.buffer],
      toData: ({ length, positions, startIndices }) =>
        length === 0
          ? null
          : { length, startIndices, attributes: { getPath: { value: positions, size: 2 } } },
      renderTile: (props, size) =>
        new PathLayer({
          id: props.id,
          data: props.data,
          getColor: [color.r, color.g, color.b, 0xff],
          getWidth: 1,
          widthUnits: 'pixels',
          widthScale: size,
          jointRounded: true,
          capRounded: true,
          pickable: false,
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
