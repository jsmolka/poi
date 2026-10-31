import Flatbush from 'flatbush';

// Margin around each tile (in screen px) so line caps/joins don't show seams at tile edges.
const BUFFER_PX = 16;
// Vertex simplification tolerance in screen px. Features are never dropped, only redundant
// vertices (collinear, duplicate, or within this distance of the line). 0.25px is invisible;
// raise it (e.g. 1) for lighter tiles at low zoom, or set 0 to send every vertex.
const SIMPLIFY_PX = 0.25;

const datasets = new Map();

self.onmessage = ({ data: message }) => {
  switch (message.type) {
    case 'init': {
      datasets.set(
        message.key,
        message.kind === 'poi'
          ? indexPois(message.positions)
          : indexWays(message.positions, message.starts),
      );
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

function indexPois(positions) {
  const bush = new Flatbush(positions.length / 2, undefined, Float32Array);
  for (let i = 0; i < positions.length; i += 2) {
    bush.add(positions[i], positions[i + 1]);
  }
  bush.finish();

  return { kind: 'poi', bush, positions };
}

function indexWays(positions, starts) {
  const n = starts.length - 1;
  if (n <= 0) return null;

  const sig = new Float32Array(positions.length / 2); // per-vertex significance
  const bush = new Flatbush(n, undefined, Float32Array);

  for (let w = 0; w < n; w++) {
    const s = starts[w];
    const e = starts[w + 1];
    if (e - s < 2) {
      bush.add(0, 0, 0, 0); // placeholder, skipped in tile()
      continue;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let v = s; v < e; v++) {
      const x = positions[2 * v];
      const y = positions[2 * v + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    bush.add(minX, minY, maxX, maxY);

    significance(positions, s, e, sig);
  }
  bush.finish();
  return { kind: 'way', bush, positions, starts, sig };
}

// Douglas-Peucker, computed once. sig[v] is the squared distance (in degrees^2) at which
// vertex v would be dropped; endpoints are Infinity. At tile time, simplifying to a
// tolerance is just "keep vertices with sig >= tol^2", with no per-tile geometry work.
// A child's significance is clamped to its parent's, so a kept vertex always has its
// ancestors kept too. Without that, the error against the final polyline can exceed the
// tolerance (measured up to ~1.8x).
function significance(pos, first, end, sig) {
  const last = end - 1;
  sig[first] = Infinity;
  sig[last] = Infinity;

  const stack = [first, last, Infinity]; // [lo, hi, parentSig] triples
  while (stack.length) {
    const bound = stack.pop();
    const hi = stack.pop();
    const lo = stack.pop();
    if (hi - lo < 2) continue;

    const ax = pos[2 * lo];
    const ay = pos[2 * lo + 1];
    const dx = pos[2 * hi] - ax;
    const dy = pos[2 * hi + 1] - ay;
    const len2 = dx * dx + dy * dy;

    let maxD = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = pos[2 * i] - ax;
      const py = pos[2 * i + 1] - ay;
      let d2;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        let t = (px * dx + py * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (idx >= 0) {
      const d = maxD < bound ? maxD : bound;
      sig[idx] = d;
      stack.push(lo, idx, d, idx, hi, d);
    }
  }
}

// ---------------------------------------------------------------------------
// Tile generation (runs per request)
// ---------------------------------------------------------------------------

function tile({ key, reqId, z, bbox, tileSize, maxZoom }) {
  const ds = datasets.get(key);
  if (!ds) {
    self.postMessage({ reqId, length: 0 });
    return;
  }

  const [west, south, east, north] = bbox;
  const tol = 360 / (tileSize * 2 ** z); // degrees of longitude per screen px at this zoom
  const cosLat = Math.max(0.05, Math.cos((((south + north) / 2) * Math.PI) / 180));
  const full = z >= maxZoom || SIMPLIFY_PX === 0; // overzoomed from the last level: full detail

  if (ds.kind === 'poi') tilePoints(ds, reqId, west, south, east, north);
  else tileWays(ds, reqId, west, south, east, north, tol, cosLat, full);
}

function tilePoints(ds, reqId, west, south, east, north) {
  const { bush, positions } = ds;
  const hits = bush.search(west, south, east, north);

  const out = new Float32Array(hits.length * 2);
  for (let k = 0; k < hits.length; k++) {
    out[2 * k] = positions[2 * hits[k]];
    out[2 * k + 1] = positions[2 * hits[k] + 1];
  }
  self.postMessage({ reqId, length: hits.length, positions: out }, [out.buffer]);
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

function tileWays(ds, reqId, west, south, east, north, tol, cosLat, full) {
  const { bush, positions, starts, sig } = ds;

  const tolY = tol * cosLat; // degrees of latitude per px (approx.)
  // Conservative: use the smaller of the two axes so nothing visible gets dropped.
  const simplifyTol = SIMPLIFY_PX * tolY;
  const thr = full ? 0 : simplifyTol * simplifyTol;

  const bx = BUFFER_PX * tol;
  const by = BUFFER_PX * tolY;
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
      if (sig[v] < thr) continue; // simplified away at this zoom

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
  self.postMessage({ reqId, length: outStarts.length, positions: result, startIndices }, [
    result.buffer,
    startIndices.buffer,
  ]);
}
