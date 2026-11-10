import { mapRange } from '@/utils/numeric';
import { Vector } from '@/utils/vector';
import Flatbush from 'flatbush';

const datasets = new Map();

let queue = [];
let scheduled = false;

function schedule() {
  if (scheduled) {
    return;
  }

  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    if (queue.length > 0) {
      tile(queue.pop());
    }
    if (queue.length > 0) {
      schedule();
    }
  });
}

self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'init': {
      datasets.set(data.key, index(data));
      break;
    }
    case 'tile': {
      queue.push(data);
      schedule();
      break;
    }
    case 'cancel': {
      const index = queue.findIndex(({ id }) => id === data.id);
      if (index !== -1) {
        queue.splice(index, 1);
      }
      break;
    }
    case 'dispose': {
      datasets.delete(data.key);
      break;
    }
    case 'terminate': {
      datasets.clear();
      self.close();
      break;
    }
  }
};

function index({ kind, positions, startIndices }) {
  return { kind, ...(kind === 'poi' ? indexPoi(positions) : indexWay(positions, startIndices)) };
}

function indexPoi(positions) {
  const vertices = positions.length / 2;
  const bush = new Flatbush(vertices, 16, Float32Array);
  for (let i = 0; i < positions.length; i += 2) {
    bush.add(positions[i], positions[i + 1]);
  }
  bush.finish();

  return { bush, positions };
}

function indexWay(positions, startIndices) {
  const count = startIndices.length - 1;
  const vertices = positions.length / 2;
  const bush = new Flatbush(count, 16, Float32Array);
  const weights = new Float32Array(vertices);
  for (let i = 0; i < count; i++) {
    const start = startIndices[i];
    const end = startIndices[i + 1];
    simplify(positions, start, end, weights);

    let minX = +Infinity;
    let maxX = -Infinity;
    let minY = +Infinity;
    let maxY = -Infinity;
    for (let vertex = start; vertex < end; vertex++) {
      const x = positions[2 * vertex];
      const y = positions[2 * vertex + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    bush.add(minX, minY, maxX, maxY);
  }
  bush.finish();

  return { bush, positions, startIndices, weights };
}

const stack = new Uint32Array(256);

function simplify(positions, start, end, weights) {
  const last = end - 1;
  weights[start] = Infinity;
  weights[last] = Infinity;

  let sp = 0;
  if (last - start >= 2) {
    stack[sp++] = start;
    stack[sp++] = last;
  }

  while (sp > 0) {
    const hi = stack[--sp];
    const lo = stack[--sp];
    const loWeight = weights[lo];
    const hiWeight = weights[hi];
    const parentWeight = loWeight < hiWeight ? loWeight : hiWeight;

    const ax = positions[2 * lo];
    const ay = positions[2 * lo + 1];
    const dx = positions[2 * hi] - ax;
    const dy = positions[2 * hi + 1] - ay;
    const lenSq = dx * dx + dy * dy;
    const invLenSq = lenSq === 0 ? 0 : 1 / lenSq;

    let maxDistSq = 0;
    let maxVertex = -1;
    for (let vertex = lo + 1; vertex < hi; vertex++) {
      const ox = positions[2 * vertex] - ax;
      const oy = positions[2 * vertex + 1] - ay;

      let t = (ox * dx + oy * dy) * invLenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;

      const ex = ox - t * dx;
      const ey = oy - t * dy;
      const distSq = ex * ex + ey * ey;

      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxVertex = vertex;
      }
    }

    if (maxVertex !== -1) {
      weights[maxVertex] = maxDistSq < parentWeight ? maxDistSq : parentWeight;

      const lenLeft = maxVertex - lo;
      const lenRight = hi - maxVertex;
      if (lenLeft > lenRight) {
        if (lenLeft >= 2) {
          stack[sp++] = lo;
          stack[sp++] = maxVertex;
        }
        if (lenRight >= 2) {
          stack[sp++] = maxVertex;
          stack[sp++] = hi;
        }
      } else {
        if (lenRight >= 2) {
          stack[sp++] = maxVertex;
          stack[sp++] = hi;
        }
        if (lenLeft >= 2) {
          stack[sp++] = lo;
          stack[sp++] = maxVertex;
        }
      }
    }
  }
}

function tile({ key, id, bbox, tileSize, zoom, maxZoom }) {
  const dataset = datasets.get(key);
  if (dataset == null) {
    self.postMessage({ id, positions: null });
    return;
  }

  if (dataset.kind === 'poi') {
    tilePoi(dataset, id, bbox);
  } else {
    tileWay(dataset, id, bbox, tileSize, zoom, maxZoom);
  }
}

function tilePoi(dataset, id, bbox) {
  const { bush, positions } = dataset;
  const visibleIndices = new Uint32Array(bush.search(bbox.west, bbox.south, bbox.east, bbox.north));
  const visiblePositions = new Float32Array(2 * visibleIndices.length);
  for (const [i, index] of visibleIndices.entries()) {
    visiblePositions[2 * i] = positions[2 * index];
    visiblePositions[2 * i + 1] = positions[2 * index + 1];
  }
  self.postMessage({ id, positions: visiblePositions, indices: visibleIndices }, [
    visiblePositions.buffer,
    visibleIndices.buffer,
  ]);
}

function tolerancePx(zoom) {
  return mapRange(zoom, 2, 8, 16, 1);
}

function tileWay(dataset, id, bbox, tileSize, zoom, maxZoom) {
  const { bush, positions, startIndices, weights } = dataset;
  const meanLat = (bbox.north + bbox.south) / 2;
  const pxToLng = 360 / (tileSize * 2 ** zoom);
  const pxToLat = Math.max(0.05, Math.cos(meanLat * (Math.PI / 180))) * pxToLng;
  const tolerance = tolerancePx(zoom) * Math.min(pxToLng, pxToLat);
  const threshold = zoom >= maxZoom ? 0 : tolerance ** 2;

  const buffer = 16;
  const visible = bush.search(
    bbox.west - buffer * pxToLng,
    bbox.south - buffer * pxToLat,
    bbox.east + buffer * pxToLng,
    bbox.north + buffer * pxToLat,
  );

  const outPositions = new Vector(Float32Array, 16 * visible.length);
  const outStartIndices = new Vector(Uint32Array, visible.length);
  const outIndices = new Vector(Uint32Array, visible.length);

  for (const index of visible) {
    const startLength = outPositions.length;
    const start = startIndices[index];
    const end = startIndices[index + 1];

    for (let vertex = start; vertex < end; vertex++) {
      if (weights[vertex] < threshold) {
        continue;
      }
      outPositions.push(positions[2 * vertex]);
      outPositions.push(positions[2 * vertex + 1]);
    }

    if (outPositions.length - startLength >= 4) {
      outStartIndices.push(startLength / 2);
      outIndices.push(index);
    } else {
      outPositions.length = startLength;
    }
  }

  const visiblePositions = outPositions.toArray();
  const visibleStartIndices = outStartIndices.toArray();
  const visibleIndices = outIndices.toArray();
  self.postMessage(
    {
      id,
      positions: visiblePositions,
      startIndices: visibleStartIndices,
      indices: visibleIndices,
    },
    [visiblePositions.buffer, visibleStartIndices.buffer, visibleIndices.buffer],
  );
}
