import { useEvent } from '@/composables/useEvent';
import { Tiler } from '@/modules/tiler';
import { satelliteUrl } from '@/utils/google';
import { mapRange, roundTo } from '@/utils/numeric';
import { TileLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import * as turf from '@turf/turf';
import { Popup } from 'mapbox-gl';

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
      const coordinate = props.data.snapTo(info.index, info.coordinate);
      const [name, openingHours] = props.metadata[props.data.indices[info.index]] ?? [];

      popup.setHTML(`
        <a href="${satelliteUrl(coordinate)}" target="_blank" class="underline">
          ${name || props.name}
        </a>
        ${openingHours ? `<br>Opening hours: ${openingHours}` : ''}
      `);
      popup.setLngLat(coordinate);
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

  const addTileLayer = ({ id, init, getTileData, renderSubLayers }) => {
    const key = tiler.init(init.data, init.transfer);

    let scale = getQuantizedScale();

    const makeLayer = () => {
      const maxZoom = 14;
      const tileSize = 512;

      return new TileLayer({
        id,
        maxZoom,
        tileSize,
        getTileData: async ({ bbox, zoom, signal }) => {
          return getTileData(await tiler.tile(key, bbox, tileSize, zoom, maxZoom, signal));
        },
        renderSubLayers: (props) => {
          return props.data ? renderSubLayers({ ...props, scale }) : null;
        },
        updateTriggers: {
          renderSubLayers: [scale],
        },
        beforeId: `${id}-anchor`,
      });
    };

    const stop = useEvent(map, 'zoom', () => {
      const value = getQuantizedScale();
      if (value !== scale) {
        scale = value;
        updateLayer(makeLayer());
      }
    });

    addLayer(makeLayer(), () => {
      tiler.dispose(key);
      stop();
    });
  };

  const addLayerPoi = ({ id, name, color, positions, metadata }) => {
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
      renderSubLayers: ({ id, data, scale }) => {
        return new ScatterplotLayer({
          id,
          data,
          name,
          metadata,
          getFillColor: [color.r, color.g, color.b, 0xff],
          getRadius: 2,
          radiusUnits: 'pixels',
          radiusScale: scale,
          pickable: true,
        });
      },
    });
  };

  const addLayerWay = ({ id, name, color, positions, startIndices, metadata }) => {
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
            return turf.lineString(coordinates);
          },

          snapTo(index, coordinate) {
            return turf.nearestPointOnLine(this.line(index), coordinate).geometry.coordinates;
          },
        };
      },
      renderSubLayers: ({ id, data, scale }) => {
        return new PathLayer({
          id,
          data,
          name,
          metadata,
          _pathType: 'open',
          getColor: [color.r, color.g, color.b, 0xff],
          getWidth: 1,
          widthUnits: 'pixels',
          widthScale: scale,
          jointRounded: true,
          capRounded: true,
          pickable: true,
        });
      },
    });
  };

  return { addLayerPoi, addLayerWay, removeLayer };
}
