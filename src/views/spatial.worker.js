import { clamp } from '@/utils/numeric';
import Flatbush from 'flatbush';

// Margin around each tile (in screen px) so line caps/joins don't show seams at tile edges.
const BUFFER_PX = 16;
// Vertex simplification tolerance in screen px. Features are never dropped, only redundant
// vertices (collinear, duplicate, or within this distance of the line). 0.25px is invisible;
// raise it (e.g. 1) for lighter tiles at low zoom, or set 0 to send every vertex.
const SIMPLIFY_PX = 1;

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

function index({ kind, positions, starts }) {
  return { kind, ...(kind === 'poi' ? indexPoi(positions) : indexWay(positions, starts)) };
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

function indexWay(positions, starts) {
  const length = starts.length - 1;
  const vertices = positions.length / 2;
  const bush = new Flatbush(length, undefined, Float32Array);
  const significances = new Float32Array(vertices);

  for (let i = 0; i < length; i++) {
    const start = starts[i];
    const end = starts[i + 1];

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

    douglasPeucker(positions, start, end, significances);
  }
  bush.finish();

  return { bush, positions, starts, significances };
}

function douglasPeucker(positions, start, end, significances) {
  const last = end - 1;
  significances[start] = Infinity;
  significances[last] = Infinity;

  const ranges = [start, last, Infinity];
  while (ranges.length > 0) {
    const parentSignificance = ranges.pop();
    const rangeStart = ranges.pop();
    const rangeEnd = ranges.pop();
    if (rangeStart - rangeEnd < 2) {
      continue;
    }

    const cordStartX = positions[2 * rangeEnd];
    const cordStartY = positions[2 * rangeEnd + 1];
    const cordDx = positions[2 * rangeStart] - cordStartX;
    const cordDy = positions[2 * rangeStart + 1] - cordStartY;
    const cordLengthSq = cordDx ** 2 + cordDy ** 2;

    let maxDistSq = 0;
    let maxVertex = -1;
    for (let vertex = rangeEnd + 1; vertex < rangeStart; vertex++) {
      const offsetX = positions[2 * vertex] - cordStartX;
      const offsetY = positions[2 * vertex + 1] - cordStartY;

      let distSq;
      if (cordLengthSq === 0) {
        distSq = offsetX ** 2 + offsetY ** 2;
      } else {
        const along = clamp((offsetX * cordDx + offsetY * cordDy) / cordLengthSq, 0, 1);
        const gapX = offsetX - along * cordDx;
        const gapY = offsetY - along * cordDy;
        distSq = gapX ** 2 + gapY ** 2;
      }
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxVertex = vertex;
      }
    }

    if (maxVertex >= 0) {
      const vertexSignificance = Math.min(maxDistSq, parentSignificance);
      significances[maxVertex] = vertexSignificance;
      ranges.push(
        rangeEnd,
        maxVertex,
        vertexSignificance,
        maxVertex,
        rangeStart,
        vertexSignificance,
      );
    }
  }
}

function tile({ key, id, bbox, size, zoom, maxZoom }) {
  const dataset = datasets.get(key);
  if (dataset == null) {
    self.postMessage({ id, length: 0 });
    return;
  }

  const [west, south, east, north] = bbox;
  if (dataset.kind === 'poi') {
    tilePoi(dataset, id, west, south, east, north);
  } else {
    const pxToLng = 360 / (size * 2 ** zoom);
    const pxToLat = Math.max(0.05, Math.cos((((south + north) / 2) * Math.PI) / 180)) * pxToLng;
    const fullDetail = zoom >= maxZoom || SIMPLIFY_PX === 0;
    tileWay(dataset, id, west, south, east, north, pxToLng, pxToLat, fullDetail);
  }
}

function tilePoi(dataset, id, west, south, east, north) {
  const { bush, positions } = dataset;
  const indices = bush.search(west, south, east, north);
  const visible = new Float32Array(indices.length * 2);
  for (const [i, index] of indices.entries()) {
    visible[2 * i] = positions[2 * index];
    visible[2 * i + 1] = positions[2 * index + 1];
  }
  self.postMessage({ id, length: indices.length, positions: visible }, [visible.buffer]);
}

let T0 = 0;
let T1 = 1;

// Liang-Barsky. On success, [T0, T1] is the visible part of the segment as fractions of a->b.
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
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }

  T0 = t0;
  T1 = t1;
  return true;
}

function tileWay(dataset, id, west, south, east, north, pxToLng, pxToLat, fullDetail) {
  const { bush, positions, starts, significances } = dataset;

  const threshold = fullDetail ? 0 : (SIMPLIFY_PX * Math.min(pxToLng, pxToLat)) ** 2;

  const bx = BUFFER_PX * pxToLng;
  const by = BUFFER_PX * pxToLat;
  const x0 = west - bx;
  const x1 = east + bx;
  const y0 = south - by;
  const y1 = north + by;

  const outPos = [];
  const outStarts = [];

  const beginPiece = () => outStarts.push(outPos.length >> 1);
  const endPiece = () => {
    const s0 = outStarts[outStarts.length - 1];
    if ((outPos.length >> 1) - s0 < 2) {
      outPos.length = s0 * 2; // piece with a single vertex: discard
      outStarts.pop();
    }
  };

  const hits = bush.search(x0, y0, x1, y1);
  for (let k = 0; k < hits.length; k++) {
    const w = hits[k];
    const s = starts[w];
    const e = starts[w + 1];
    if (e - s < 2) continue;

    let have = false;
    let open = false;
    let ax = 0;
    let ay = 0;

    for (let v = s; v < e; v++) {
      if (significances[v] < threshold) continue; // simplified away at this zoom

      const x = positions[2 * v];
      const y = positions[2 * v + 1];

      if (have) {
        if (clipSegment(ax, ay, x, y, x0, y0, x1, y1)) {
          const dx = x - ax;
          const dy = y - ay;
          if (!open || T0 > 0) {
            if (open) endPiece();
            beginPiece();
            outPos.push(ax + T0 * dx, ay + T0 * dy);
          }
          outPos.push(ax + T1 * dx, ay + T1 * dy);
          open = T1 >= 1;
          if (!open) endPiece(); // the line left the (buffered) tile
        } else if (open) {
          endPiece();
          open = false;
        }
      }

      ax = x;
      ay = y;
      have = true;
    }
    if (open) endPiece();
  }

  const result = Float32Array.from(outPos);
  const startIndices = Uint32Array.from(outStarts);
  self.postMessage({ id, length: outStarts.length, positions: result, startIndices }, [
    result.buffer,
    startIndices.buffer,
  ]);
}
