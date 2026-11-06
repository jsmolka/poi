import Flatbush from 'flatbush';

const datasets = new Map();

self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'init': {
      datasets.set(data.key, index(data));
      break;
    }
    case 'tile': {
      tile(data);
      break;
    }
    case 'dispose': {
      datasets.delete(data.key);
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

const stack = new Float32Array(1024);

function simplify(positions, start, end, weights) {
  const last = end - 1;
  weights[start] = Infinity;
  weights[last] = Infinity;

  let sp = 0;
  if (last - start >= 2) {
    stack[sp++] = start;
    stack[sp++] = last;
    stack[sp++] = Infinity;
  }

  while (sp > 0) {
    sp -= 3;
    const lo = stack[sp];
    const hi = stack[sp + 1];
    const parentWeight = stack[sp + 2];

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
      const weight = maxDistSq < parentWeight ? maxDistSq : parentWeight;
      weights[maxVertex] = weight;

      const lenLeft = maxVertex - lo;
      const lenRight = hi - maxVertex;
      if (lenLeft > lenRight) {
        if (lenLeft >= 2) {
          stack[sp++] = lo;
          stack[sp++] = maxVertex;
          stack[sp++] = weight;
        }
        if (lenRight >= 2) {
          stack[sp++] = maxVertex;
          stack[sp++] = hi;
          stack[sp++] = weight;
        }
      } else {
        if (lenRight >= 2) {
          stack[sp++] = maxVertex;
          stack[sp++] = hi;
          stack[sp++] = weight;
        }
        if (lenLeft >= 2) {
          stack[sp++] = lo;
          stack[sp++] = maxVertex;
          stack[sp++] = weight;
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
    const lat = (bbox.north + bbox.south) / 2;
    const pxToLng = 360 / (tileSize * 2 ** zoom);
    const pxToLat = Math.max(0.05, Math.cos(lat * (Math.PI / 180))) * pxToLng;
    const fullDetail = zoom >= maxZoom;
    tileWay(dataset, id, bbox, pxToLng, pxToLat, fullDetail);
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

function tileWay(dataset, id, bbox, pxToLng, pxToLat, fullDetail) {
  const { bush, positions, startIndices, weights } = dataset;
  const threshold = fullDetail ? 0 : Math.min(pxToLng, pxToLat) ** 2;

  const outPositions = [];
  const outStartIndices = [];
  const outIndices = [];

  const buffer = 16;
  const visible = bush.search(
    bbox.west - buffer * pxToLng,
    bbox.south - buffer * pxToLat,
    bbox.east + buffer * pxToLng,
    bbox.north + buffer * pxToLat,
  );
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

  const visiblePositions = Float32Array.from(outPositions);
  const visibleStartIndices = Uint32Array.from(outStartIndices);
  const visibleIndices = Uint32Array.from(outIndices);
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
