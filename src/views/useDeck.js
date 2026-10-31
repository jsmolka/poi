import { clamp, lerp } from '@/utils/numeric';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import Flatbush from 'flatbush';

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

  const getPaddedBounds = (padding = undefined) => {
    padding ??= 0.25;

    const bounds = map.getBounds();
    const w = bounds.getWest();
    const e = bounds.getEast();
    const s = bounds.getSouth();
    const n = bounds.getNorth();

    const viewW = e - w;
    const viewH = n - s;
    const dx = padding * viewW;
    const dy = padding * viewH;
    return {
      w: w - dx,
      e: e + dx,
      s: Math.max(-90, s - dy),
      n: Math.min(+90, n + dy),
      viewW,
      viewH,
    };
  };

  const getPaddedBoxes = (padding = undefined) => {
    const { w, e, s, n } = getPaddedBounds(padding);
    if (e - w >= 360) {
      return [[-180, s, 180, n]];
    } else if (w < -180) {
      return [
        [w + 360, s, 180, n],
        [-180, s, e, n],
      ];
    } else if (e > 180) {
      return [
        [w, s, 180, n],
        [-180, s, e - 360, n],
      ];
    } else {
      return [[w, s, e, n]];
    }
  };

  function isLeavingPaddedBounds(loadedBounds) {
    const bounds = getPaddedBounds(0.05);
    if (
      loadedBounds == null ||
      loadedBounds.s > bounds.s ||
      loadedBounds.n < bounds.n ||
      loadedBounds.viewW > 2 * bounds.viewW
    ) {
      return true;
    }

    if (loadedBounds.e - loadedBounds.w >= 360) {
      return false;
    }

    for (const wrap of [-360, 0, 360]) {
      if (bounds.w + wrap > loadedBounds.w && bounds.e + wrap < loadedBounds.e) {
        return false;
      }
    }
    return true;
  }

  const scale = () => {
    const minZoom = 6;
    const maxZoom = 18;
    const minSize = 0.5;
    const maxSize = 8;
    return lerp(minSize, maxSize, clamp((map.getZoom() - minZoom) / (maxZoom - minZoom), 0, 1));
  };

  const addLayerPoi = (id, polyline, color, beforeId = undefined) => {
    const bush = new Flatbush(polyline.length / 2, undefined, Float32Array);
    for (let i = 0; i < polyline.length; i += 2) {
      const x = polyline[i];
      const y = polyline[i + 1];
      bush.add(x, y);
    }
    bush.finish();

    let loadedBounds = null;

    function queryVisible() {
      const indices = [];
      loadedBounds = getPaddedBounds();
      for (const [minX, minY, maxX, maxY] of getPaddedBoxes()) {
        for (const index of bush.search(minX, minY, maxX, maxY)) {
          indices.push(index);
        }
      }

      const visiblePositions = new Float32Array(2 * indices.length);
      for (const [i, index] of indices.entries()) {
        visiblePositions[2 * i] = polyline[2 * index];
        visiblePositions[2 * i + 1] = polyline[2 * index + 1];
      }

      return {
        length: indices.length,
        attributes: { getPosition: { value: visiblePositions, size: 2 } },
      };
    }

    let data = queryVisible();

    const makeLayer = () => {
      return new ScatterplotLayer({
        id,
        data,
        getFillColor: [color.r, color.g, color.b, 0xff],
        getRadius: 2,
        radiusUnits: 'pixels',
        radiusScale: scale(),
        jointRounded: true,
        capRounded: true,
        beforeId,
      });
    };

    const update = () => {
      if (isLeavingPaddedBounds(loadedBounds)) {
        (async () => {
          console.time('P');
          data = queryVisible();
          updateLayer(makeLayer());
          console.timeEnd('P');
        })();
      }
    };

    map.on('move', update);

    addLayer(makeLayer(), () => {
      map.off('move', update);
    });
  };

  const addLayerWay = (id, polylines, color, beforeId = undefined) => {
    const bush = new Flatbush(polylines.length, undefined, Float32Array);
    for (const polyline of polylines) {
      let minX = +Infinity;
      let maxX = -Infinity;
      let minY = +Infinity;
      let maxY = -Infinity;
      for (const [i, coordinate] of polyline.entries()) {
        if ((i & 0x1) === 0) {
          minX = Math.min(minX, coordinate);
          maxX = Math.max(maxX, coordinate);
        } else {
          minY = Math.min(minY, coordinate);
          maxY = Math.max(maxY, coordinate);
        }
      }
      bush.add(minX, minY, maxX, maxY);
    }
    bush.finish();

    let loadedBounds = null;

    function queryVisible() {
      loadedBounds = getPaddedBounds();

      const indices = [];
      for (const [minX, minY, maxX, maxY] of getPaddedBoxes()) {
        for (const index of bush.search(minX, minY, maxX, maxY)) {
          indices.push(index);
        }
      }

      let total = 0;
      for (const index of indices) {
        total += polylines[index].length;
      }

      const visiblePositions = new Float32Array(total);
      const visibleStarts = new Uint32Array(indices.length);

      let vertices = 0;
      for (const [i, index] of indices.entries()) {
        visibleStarts[i] = vertices;
        visiblePositions.set(polylines[index], vertices * 2);
        vertices += polylines[index].length / 2;
      }

      return {
        length: indices.length,
        startIndices: visibleStarts,
        attributes: { getPath: { value: visiblePositions, size: 2 } },
      };
    }

    let data = queryVisible();

    const makeLayer = () => {
      return new PathLayer({
        id,
        data,
        getColor: [color.r, color.g, color.b, 0xff],
        getWidth: 1,
        widthUnits: 'pixels',
        widthScale: scale(),
        jointRounded: true,
        capRounded: true,
        beforeId,
      });
    };

    const update = () => {
      if (isLeavingPaddedBounds(loadedBounds)) {
        (async () => {
          console.time('W');
          data = queryVisible();
          updateLayer(makeLayer());
          console.timeEnd('W');
        })();
      }
    };

    map.on('move', update);

    addLayer(makeLayer(), () => {
      map.off('move', update);
    });
  };

  return {
    addLayerPoi,
    addLayerWay,
    removeLayer,
  };
}
