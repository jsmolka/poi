import { useEvent } from '@/composables/useEvent';
import { Tiler } from '@/modules/tiler';
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

  const getPopupLngLat = (info) => {
    if (info.sourceLayer instanceof ScatterplotLayer) {
      const data = info.sourceLayer.props.data;
      const positions = data.attributes.getPosition.value;
      return [positions[2 * info.index], positions[2 * info.index + 1]];
    }

    if (info.sourceLayer instanceof PathLayer) {
      const data = info.sourceLayer.props.data;
      const positions = data.attributes.getPath.value;
      const startIndices = data.startIndices;
      const start = startIndices[info.index];
      const end = startIndices[info.index + 1] ?? positions.length / 2;
      const line = [];
      for (let vertex = start; vertex < end; vertex++) {
        line.push([positions[2 * vertex], positions[2 * vertex + 1]]);
      }
      return turf.nearestPointOnLine(turf.lineString(line), info.coordinate).geometry.coordinates;
    }

    return info.coordinate;
  };

  const satelliteUrl = (lng, lat, zoom = 21) => {
    const params = new URLSearchParams({
      api: '1',
      map_action: 'map',
      center: `${lat},${lng}`,
      zoom: String(zoom),
      basemap: 'satellite',
    });
    return `https://www.google.com/maps/@?${params}`;
  };

  const getPopupContent = (info, lngLat) => {
    const [name, openingHours] =
      info.sourceLayer.props.metadata[info.sourceLayer.props.data.indices[info.index]] ?? [];
    return `
      <a href="${satelliteUrl(lngLat[0], lngLat[1])}" target="_blank" class="underline">
        ${name || info.sourceLayer.props.name}
      </a>
      ${openingHours ? `<br>Opening hours: ${openingHours}` : ''}
    `;
  };

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

      const lngLat = getPopupLngLat(info);
      if (lngLat == null) {
        popup.remove();
        return;
      }

      popup.setLngLat(lngLat);
      popup.setHTML(getPopupContent(info, lngLat));
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

  const addTiledLayer = ({ id, init, getTileData, renderSubLayers, beforeId }) => {
    const key = tiler.init(init.data, init.transfer);

    let scale = getQuantizedScale();

    const makeLayer = () => {
      const minZoom = 0;
      const maxZoom = 14;
      const tileSize = 512;

      return new TileLayer({
        id,
        minZoom,
        maxZoom,
        tileSize,
        getTileData: async ({ bbox, index, signal }) => {
          return getTileData(await tiler.tile(key, bbox, tileSize, index.z, maxZoom, signal));
        },
        renderSubLayers: (props) => {
          return renderSubLayers({ ...props, scale });
        },
        updateTriggers: {
          renderSubLayers: [scale],
        },
        beforeId,
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
      stop();
      tiler.dispose(key);
    });
  };

  const addLayerPoi = ({ id, name, positions, metadata, color, beforeId }) => {
    addTiledLayer({
      id,
      init: {
        data: { kind: 'poi', positions },
        transfer: [positions.buffer],
      },
      getTileData: ({ positions, indices }) => {
        if (positions == null) {
          return null;
        }
        return {
          length: positions.length / 2,
          attributes: { getPosition: { value: positions, size: 2 } },
          indices,
        };
      },
      renderSubLayers: (props) => {
        return new ScatterplotLayer({
          id: props.id,
          data: props.data,
          name,
          metadata,
          getFillColor: [color.r, color.g, color.b, 0xff],
          getRadius: 2,
          radiusUnits: 'pixels',
          radiusScale: props.scale,
          pickable: true,
        });
      },
      beforeId,
    });
  };

  const addLayerWay = ({ id, name, positions, startIndices, metadata, color, beforeId }) => {
    addTiledLayer({
      id,
      init: {
        data: { kind: 'way', positions, startIndices },
        transfer: [positions.buffer, startIndices.buffer],
      },
      getTileData: ({ positions, startIndices, indices }) => {
        if (positions == null) {
          return null;
        }
        return {
          startIndices,
          length: startIndices.length,
          attributes: { getPath: { value: positions, size: 2 } },
          indices,
        };
      },
      renderSubLayers: (props) => {
        return new PathLayer({
          id: props.id,
          data: props.data,
          name,
          metadata,
          _pathType: 'open',
          getColor: [color.r, color.g, color.b, 0xff],
          getWidth: 1,
          widthUnits: 'pixels',
          widthScale: props.scale,
          jointRounded: true,
          capRounded: true,
          pickable: true,
        });
      },
      beforeId,
    });
  };

  return {
    addLayerPoi,
    addLayerWay,
    removeLayer,
  };
}
