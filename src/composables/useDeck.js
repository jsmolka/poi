import { Tiler } from '@/modules/tiler';
import { onEvent } from '@/utils/event';
import { satelliteUrl } from '@/utils/google';
import { mapRange, roundTo } from '@/utils/numeric';
import { TileLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { lineString } from '@turf/helpers';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';
import { Popup } from 'mapbox-gl';
import { onScopeDispose } from 'vue';

export function useDeck(map) {
  const popup = new Popup({
    closeButton: false,
    closeOnClick: false,
  });

  const overlay = new MapboxOverlay({
    interleaved: true,
    getCursor: ({ isHovering, isDragging }) => {
      return isHovering && !isDragging ? 'pointer' : '';
    },
    onClick: (info) => {
      if (!info.picked) {
        popup.remove();
        return;
      }

      const props = info.sourceLayer.props;
      const lngLat = props.data.snapTo(info.index, info.coordinate);
      const [name, openingHours] = props.metadata[props.data.indices[info.index]] ?? [];

      popup.setHTML(`
        <a href="${satelliteUrl(lngLat)}" target="_blank" class="underline">
          ${name || props.name}
        </a>
        ${openingHours ? `<br>Opening hours: ${openingHours}` : ''}
      `);
      popup.setLngLat(lngLat);
      popup.addTo(map);
    },
  });

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
    popup.remove();

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
    const getFillColor = new Uint8Array([color.r, color.g, color.b, 0xff]);

    addTileLayer({
      id,
      init: {
        data: { kind: 'poi', positions },
        transfer: [positions.buffer],
      },
      getTileData: ({ positions, indices }) => {
        if (positions == null || positions.length === 0) {
          return null;
        }
        return {
          length: positions.length / 2,
          attributes: { getPosition: { value: positions, size: 2 } },
          indices,

          snapTo(index) {
            return [positions[2 * index], positions[2 * index + 1]];
          },
        };
      },
      renderSubLayers: ({ id, data, scale, detailed }) => {
        return new ScatterplotLayer({
          id,
          data,
          name,
          metadata,
          positionFormat: 'XY',
          getFillColor,
          getRadius: 2,
          radiusUnits: 'pixels',
          radiusScale: scale,
          pickable: detailed,
        });
      },
      beforeId,
    });
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

    popup.remove();
    tiler.terminate();
    map.removeControl(overlay);
  });

  return { addLayerPoi, addLayerWay, removeLayer };
}
