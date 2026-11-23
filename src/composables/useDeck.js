import { usePoiRenderer } from '@/modules/poiRenderer';
import { useWayRenderer } from '@/modules/wayRenderer';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { onScopeDispose } from 'vue';

export function useDeck(map) {
  const poiRenderer = usePoiRenderer(map);
  const wayRenderer = useWayRenderer(map);
  const overlay = new MapboxOverlay({ interleaved: true });

  map.addControl(overlay);

  const removeLayer = (id) => {
    poiRenderer.removeLayerPoi(id);
    wayRenderer.removeLayerWay(id);
  };

  const addLayerPoi = ({ id, name, color, positions, metadata, beforeId }) => {
    poiRenderer.addLayerPoi({ id, name, color, positions, metadata, beforeId });
  };

  const addLayerWay = ({ id, name, color, positions, startIndices, metadata, beforeId }) => {
    wayRenderer.addLayerWay({ id, name, color, positions, startIndices, metadata, beforeId });
  };

  onScopeDispose(() => {
    poiRenderer.dispose();
    wayRenderer.dispose();
    map.removeControl(overlay);
  });

  return { addLayerPoi, addLayerWay, removeLayer };
}
