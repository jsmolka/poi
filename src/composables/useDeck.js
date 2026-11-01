import { Tiler } from '@/modules/tiler';
import { mapRange, roundTo } from '@/utils/numeric';
import { TileLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Popup } from 'mapbox-gl';

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

  const overlay = new MapboxOverlay({
    interleaved: true,
    getCursor: ({ isHovering, isDragging }) => (isHovering && !isDragging ? 'pointer' : ''),
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

    syncLayers();
  };

  const updateLayer = (layer) => {
    layers.set(layer.id, layer);

    syncLayers();
  };

  const syncLayers = () => {
    overlay.setProps({ layers: Array.from(layers.values()) });
  };

  const getScale = () => {
    return mapRange(map.getZoom(), 6, 18, 0.5, 8);
  };

  const getQuantizedScale = () => {
    return roundTo(getScale(), 0.25);
  };

  const tiler = new Tiler();

  // ---- shared tiled-layer helper ---------------------------------------------

  const addTiledLayer = ({ id, beforeId, getPopup, init, transfer, data, render }) => {
    const key = tiler.init(init, transfer);

    let scale = getQuantizedScale();

    const makeLayer = () => {
      const minZoom = 0;
      const maxZoom = 14;
      const tileSize = 512;
      return new TileLayer({
        id,
        beforeId,
        minZoom,
        maxZoom,
        tileSize,
        getTileData: async ({ bbox, index, signal }) => {
          return data(await tiler.tile(key, bbox, tileSize, index.z, maxZoom, signal));
        },
        renderSubLayers: (props) => {
          return props.data ? render(props.id, props.data, scale) : null;
        },
        updateTriggers: { renderSubLayers: [scale] },
      });
    };

    const onZoom = () => {
      const next = getQuantizedScale();
      if (next !== scale) {
        scale = next;
        updateLayer(makeLayer());
      }
    };

    map.on('zoom', onZoom);
    addLayer(makeLayer(), () => {
      map.off('zoom', onZoom);
      tiler.dispose(key);
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
      data: ({ positions }) =>
        positions == null
          ? null
          : {
              length: positions.length / 2,
              attributes: {
                getPosition: { value: positions, size: 2 },
              },
            },
      render: (id, data, scale) =>
        new ScatterplotLayer({
          id,
          data,
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

    const startIndices = new Uint32Array(polylines.length + 1);
    for (const [i, polyline] of polylines.entries()) {
      startIndices[i] = total;
      total += polyline.length / 2;
    }
    startIndices[polylines.length] = total;

    const positions = new Float32Array(2 * total);
    for (const [i, polyline] of polylines.entries()) {
      positions.set(polyline, 2 * startIndices[i]);
    }

    addTiledLayer({
      id,
      beforeId,
      getPopup,
      init: { kind: 'way', positions, startIndices },
      transfer: [positions.buffer, startIndices.buffer],
      data: ({ positions, startIndices }) => {
        if (positions == null) {
          return null;
        }
        return {
          startIndices,
          length: startIndices.length,
          attributes: { getPath: { value: positions, size: 2 } },
        };
      },
      render: (id, data, scale) =>
        new PathLayer({
          id,
          data,
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
