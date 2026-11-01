import { clamp } from '@/utils/numeric';
import Flatbush from 'flatbush';

const datasets = new Map();

self.onmessage = ({ data: message }) => {
  switch (message.type) {
    case 'init': {
      datasets.set(message.key, index(message));
      break;
    }
    case 'tile': {
      tile(message);
      break;
    }
    case 'dispose': {
      datasets.delete(message.key);
      break;
    }
  }
};

function index({ kind, positions, startIndices }) {
  return { kind, ...(kind === 'poi' ? indexPoi(positions) : indexWay(positions, startIndices)) };
}

function indexPoi(positions) {
  const vertices = positions.length / 2;
  const bush = new Flatbush(vertices, undefined, Float32Array);

  for (let i = 0; i < positions.length; i += 2) {
    bush.add(positions[i], positions[i + 1]);
  }
  bush.finish();

  return { bush, positions };
}

function indexWay(positions, startIndices) {
  const length = startIndices.length - 1;
  const vertices = positions.length / 2;
  const bush = new Flatbush(length, undefined, Float32Array);
  const weights = new Float32Array(vertices);

  for (let i = 0; i < length; i++) {
    const start = startIndices[i];
    const end = startIndices[i + 1];

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

    simplify(positions, start, end, weights);
  }
  bush.finish();

  return { bush, positions, starts: startIndices, weights };
}

function simplify(positions, start, end, weights) {
  const last = end - 1;
  weights[start] = Infinity;
  weights[last] = Infinity;

  const stack = [start, last, Infinity];
  while (stack.length > 0) {
    const parentWeight = stack.pop();
    const hi = stack.pop();
    const lo = stack.pop();
    if (hi - lo < 2) {
      continue;
    }

    const ax = positions[2 * lo];
    const bx = positions[2 * lo + 1];
    const dx = positions[2 * hi] - ax;
    const dy = positions[2 * hi + 1] - bx;
    const lenSq = dx ** 2 + dy ** 2;

    let maxDistSq = 0;
    let maxVertex = null;
    for (let vertex = lo + 1; vertex < hi; vertex++) {
      const ox = positions[2 * vertex] - ax;
      const oy = positions[2 * vertex + 1] - bx;

      let distSq;
      if (lenSq === 0) {
        distSq = ox ** 2 + oy ** 2;
      } else {
        const t = clamp((ox * dx + oy * dy) / lenSq, 0, 1);
        const gx = ox - t * dx;
        const ty = oy - t * dy;
        distSq = gx ** 2 + ty ** 2;
      }
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxVertex = vertex;
      }
    }

    if (maxVertex != null) {
      const weight = Math.min(maxDistSq, parentWeight);
      weights[maxVertex] = weight;
      stack.push(lo, maxVertex, weight, maxVertex, hi, weight);
    }
  }
}

function tile({ key, id, bbox, size, zoom, maxZoom }) {
  const dataset = datasets.get(key);
  if (dataset == null) {
    self.postMessage({ id, positions: null });
    return;
  }

  const [west, south, east, north] = bbox;
  if (dataset.kind === 'poi') {
    tilePoi(dataset, id, west, south, east, north);
  } else {
    const pxToLng = 360 / (size * 2 ** zoom);
    const pxToLat = Math.max(0.05, Math.cos((((south + north) / 2) * Math.PI) / 180)) * pxToLng;
    const fullDetail = zoom >= maxZoom;
    tileWay(dataset, id, west, south, east, north, pxToLng, pxToLat, fullDetail);
  }
}

function tilePoi(dataset, id, west, south, east, north) {
  const { bush, positions } = dataset;

  const indices = bush.search(west, south, east, north);
  const visiblePositions = new Float32Array(indices.length * 2);
  for (const [i, index] of indices.entries()) {
    visiblePositions[2 * i] = positions[2 * index];
    visiblePositions[2 * i + 1] = positions[2 * index + 1];
  }
  self.postMessage({ id, positions: visiblePositions }, [visiblePositions.buffer]);
}

function clipSegment(ax, ay, bx, by, x0, y0, x1, y1) {
  const dx = bx - ax;
  const dy = by - ay;

  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 4; k++) {
    let p;
    let q;
    if (k === 0) {
      p = -dx;
      q = ax - x0;
    } else if (k === 1) {
      p = dx;
      q = x1 - ax;
    } else if (k === 2) {
      p = -dy;
      q = ay - y0;
    } else {
      p = dy;
      q = y1 - ay;
    }

    if (p === 0) {
      if (q < 0) {
        return null;
      }
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [t0, t1];
}

function tileWay(dataset, id, west, south, east, north, pxToLng, pxToLat, fullDetail) {
  const { bush, positions, starts, weights } = dataset;

  const outPositions = [];
  const outStartIndices = [];

  const startPiece = () => {
    outStartIndices.push(outPositions.length / 2);
  };
  const endPiece = () => {
    const start = outStartIndices.at(-1);
    if (outPositions.length / 2 - start <= 1) {
      outPositions.length = 2 * start;
      outStartIndices.pop();
    }
  };

  const buffer = 16;
  const minX = west - buffer * pxToLng;
  const maxX = east + buffer * pxToLng;
  const minY = south - buffer * pxToLat;
  const maxY = north + buffer * pxToLat;
  const indices = bush.search(minX, minY, maxX, maxY);
  const threshold = fullDetail ? 0 : Math.min(pxToLng, pxToLat) ** 2;
  for (const index of indices) {
    const start = starts[index];
    const end = starts[index + 1];

    let have = false;
    let open = false;
    let ax = 0;
    let ay = 0;

    for (let vertex = start; vertex < end; vertex++) {
      if (weights[vertex] < threshold) {
        continue;
      }

      const x = positions[2 * vertex];
      const y = positions[2 * vertex + 1];

      if (have) {
        const clip = clipSegment(ax, ay, x, y, minX, minY, maxX, maxY);
        if (clip) {
          const [t0, t1] = clip;
          const dx = x - ax;
          const dy = y - ay;
          if (!open || t0 > 0) {
            if (open) {
              endPiece();
            }
            startPiece();
            outPositions.push(ax + t0 * dx, ay + t0 * dy);
          }

          outPositions.push(ax + t1 * dx, ay + t1 * dy);

          open = t1 >= 1;
          if (!open) {
            endPiece();
          }
        } else if (open) {
          endPiece();
          open = false;
        }
      }

      ax = x;
      ay = y;
      have = true;
    }
    if (open) {
      endPiece();
    }
  }

  const visiblePositions = Float32Array.from(outPositions);
  const visibleStartIndices = Uint32Array.from(outStartIndices);
  self.postMessage({ id, positions: visiblePositions, startIndices: visibleStartIndices }, [
    visiblePositions.buffer,
    visibleStartIndices.buffer,
  ]);
}
