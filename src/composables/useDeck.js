import { usePoiRenderer } from '@/modules/poiRenderer';
import { Tiler } from '@/modules/tiler';
import { onEvent } from '@/utils/event';
import { mapRange, roundTo } from '@/utils/numeric';
import { TileLayer } from '@deck.gl/geo-layers';
import { PathLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { lineString } from '@turf/helpers';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';
import { onScopeDispose } from 'vue';

export function useDeck(map) {
  const poiRenderer = usePoiRenderer(map);
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
    poiRenderer.removeLayerPoi(id);
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

  let queued = false;

  const syncLayers = () => {
    if (queued) {
      return;
    }

    queued = true;
    queueMicrotask(() => {
      queued = false;
      overlay.setProps({ layers: Array.from(layers.values()) });
    });
  };

  const getQuantizedZoom = () => {
    return roundTo(map.getZoom(), 0.25);
  };

  const getScale = () => {
    return mapRange(getQuantizedZoom(), 6, 18, 0.5, 8);
  };

  const getDetailed = () => {
    return getQuantizedZoom() >= 8;
  };

  const tiler = new Tiler();

  const addTileLayer = ({ id, init, getTileData, renderSubLayers, beforeId }) => {
    const key = tiler.init(init.data, init.transfer);

    let scale = getScale();
    let detailed = getDetailed();

    const makeLayer = () => {
      const maxZoom = 12;
      const tileSize = 512;

      return new TileLayer({
        id,
        maxZoom,
        tileSize,
        debounceTime: 100,
        getTileData: async ({ bbox, zoom, signal }) => {
          return getTileData(await tiler.tile(key, bbox, tileSize, zoom, maxZoom, signal));
        },
        renderSubLayers: (props) => {
          return props.data ? renderSubLayers({ ...props, scale, detailed }) : null;
        },
        updateTriggers: {
          getTileData: key,
          renderSubLayers: [scale, detailed],
        },
        beforeId,
      });
    };

    const off = onEvent(map, 'zoom', () => {
      const nextScale = getScale();
      const nextDetailed = getDetailed();
      if (scale === nextScale && detailed === nextDetailed) {
        return;
      }

      scale = nextScale;
      detailed = nextDetailed;
      updateLayer(makeLayer());
    });

    addLayer(makeLayer(), () => {
      tiler.dispose(key);
      off();
    });
  };

  const addLayerPoi = ({ id, name, color, positions, metadata, beforeId }) => {
    poiRenderer.addLayerPoi({ id, name, color, positions, metadata, beforeId });
  };

  const addLayerWay = ({ id, name, color, positions, startIndices, metadata, beforeId }) => {
    const getColor = new Uint8Array([color.r, color.g, color.b, 0xff]);

    addTileLayer({
      id,
      init: {
        data: { kind: 'way', positions, startIndices },
        transfer: [positions.buffer, startIndices.buffer],
      },
      getTileData: ({ positions, startIndices, indices }) => {
        if (positions == null || positions.length === 0) {
          return null;
        }
        return {
          startIndices,
          length: startIndices.length,
          attributes: { getPath: { value: positions, size: 2 } },
          byteLength: positions.byteLength + startIndices.byteLength + indices.byteLength,
          indices,

          line(index) {
            const start = startIndices[index];
            const end = startIndices[index + 1] ?? positions.length / 2;
            const coordinates = [];
            for (let vertex = start; vertex < end; vertex++) {
              coordinates.push([positions[2 * vertex], positions[2 * vertex + 1]]);
            }
            return lineString(coordinates);
          },

          snapTo(index, lngLat) {
            return nearestPointOnLine(this.line(index), lngLat).geometry.coordinates;
          },
        };
      },
      renderSubLayers: ({ id, data, scale, detailed }) => {
        return new PathLayer({
          id,
          data,
          name,
          metadata,
          _pathType: 'open',
          positionFormat: 'XY',
          getColor,
          getWidth: 1,
          widthUnits: 'pixels',
          widthScale: scale,
          antialiasing: true,
          jointRounded: true,
          capRounded: true,
          pickable: detailed,
        });
      },
      beforeId,
    });
  };

  onScopeDispose(() => {
    layers.clear();
    for (const cleanup of cleanups.values()) {
      cleanup();
    }
    cleanups.clear();

    poiRenderer.dispose();
    tiler.terminate();
    map.removeControl(overlay);
  });

  return { addLayerPoi, addLayerWay, removeLayer };
}
