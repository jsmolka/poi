import { createProgram } from '@/utils/gl';
import { satelliteUrl } from '@/utils/googleMaps';
import Flatbush from 'flatbush';
import { Popup } from 'mapbox-gl';

const BIN_COUNT = 32;
const BIN_TOTAL = BIN_COUNT * BIN_COUNT;
const BIN_BUFFER = 1;
const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
const CORNERS_PER_SEGMENT = 6;
const FLOATS_PER_SEGMENT = 8;
const LOD_STRIDES = [1, 4, 32];
const LOD_TILE_ZOOMS = [17, 13, 5];
const LOD_ZOOMS = [10, 6];

function getLodIndex(zoom) {
  if (zoom >= LOD_ZOOMS[0]) return 0;
  if (zoom <= LOD_ZOOMS[1]) return 2;
  return 1;
}

const vertexShader = `#version 300 es
  in vec2 a_startHigh;
  in vec2 a_startLow;
  in vec2 a_endHigh;
  in vec2 a_endLow;
  in vec2 a_corner;
  uniform mat4 u_matrix;
  uniform vec2 u_originHigh;
  uniform vec2 u_originLow;
  uniform vec4 u_originClip;
  uniform vec2 u_viewport;
  uniform highp float u_lineWidth;
  out vec2 v_start;
  out vec2 v_end;

  void main() {
    vec2 startHigh = a_startHigh - u_originHigh;
    vec2 startLow = a_startLow - u_originLow;
    vec2 endHigh = a_endHigh - u_originHigh;
    vec2 endLow = a_endLow - u_originLow;
    vec4 startClip = u_originClip + u_matrix * vec4(startHigh, 0.0, 0.0)
      + u_matrix * vec4(startLow, 0.0, 0.0);
    vec4 endClip = u_originClip + u_matrix * vec4(endHigh, 0.0, 0.0)
      + u_matrix * vec4(endLow, 0.0, 0.0);
    v_start = (startClip.xy / startClip.w * 0.5 + 0.5) * u_viewport;
    v_end = (endClip.xy / endClip.w * 0.5 + 0.5) * u_viewport;

    vec2 segment = v_end - v_start;
    vec2 direction = segment / max(length(segment), 0.0001);
    vec2 normal = vec2(-direction.y, direction.x);
    vec4 clip = mix(startClip, endClip, (a_corner.x + 1.0) * 0.5);
    vec2 offset = (direction * a_corner.x + normal * a_corner.y) * (u_lineWidth * 0.5);
    clip.xy += offset * (2.0 / u_viewport) * clip.w;
    gl_Position = clip;
  }
`;

const fragmentShader = `#version 300 es
  precision mediump float;
  uniform vec4 u_color;
  uniform highp float u_lineWidth;
  in vec2 v_start;
  in vec2 v_end;
  out vec4 fragColor;

  void main() {
    vec2 segment = v_end - v_start;
    float lengthSquared = max(dot(segment, segment), 0.0001);
    float t = clamp(dot(gl_FragCoord.xy - v_start, segment) / lengthSquared, 0.0, 1.0);
    float distanceToLine = length(gl_FragCoord.xy - (v_start + t * segment));
    float edgeWidth = max(fwidth(distanceToLine), 0.5);
    float alpha = 1.0 - smoothstep(u_lineWidth * 0.5 - edgeWidth, u_lineWidth * 0.5 + edgeWidth, distanceToLine);
    fragColor = vec4(u_color.rgb * alpha, u_color.a * alpha);
  }
`;

function projectPosition(lng, lat) {
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const radians = (clampedLat * Math.PI) / 180;
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2];
}

function projectLatitude(lat) {
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const radians = (clampedLat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2;
}

function writeSegment(target, offset, x1, y1, x2, y2) {
  const highX1 = Math.fround(x1);
  const highY1 = Math.fround(y1);
  const highX2 = Math.fround(x2);
  const highY2 = Math.fround(y2);
  target[offset] = highX1;
  target[offset + 1] = highY1;
  target[offset + 2] = x1 - highX1;
  target[offset + 3] = y1 - highY1;
  target[offset + 4] = highX2;
  target[offset + 5] = highY2;
  target[offset + 6] = x2 - highX2;
  target[offset + 7] = y2 - highY2;
}

function createSegmentData(positions, projectedPositions, startIndices, stride, tileZoom) {
  let segmentCount = 0;
  for (let line = 0; line < startIndices.length - 1; line++) {
    const vertices = startIndices[line + 1] - startIndices[line];
    if (vertices > 1) segmentCount += Math.ceil((vertices - 1) / stride);
  }
  if (segmentCount === 0) return null;

  const segmentStarts = new Uint32Array(segmentCount);
  const segmentEnds = new Uint32Array(segmentCount);
  const tileCount = 2 ** tileZoom;
  const tileCounts = new Map();
  const bush = new Flatbush(segmentCount, 16, Float32Array);
  let longCount = 0;
  let segment = 0;

  for (let line = 0; line < startIndices.length - 1; line++) {
    const start = startIndices[line];
    const end = startIndices[line + 1];
    for (let vertex = start; vertex < end - 1; vertex += stride) {
      const next = Math.min(vertex + stride, end - 1);
      const lng1 = positions[2 * vertex];
      const lat1 = positions[2 * vertex + 1];
      const lng2 = positions[2 * next];
      const lat2 = positions[2 * next + 1];
      const x1 = projectedPositions[2 * vertex];
      const y1 = projectedPositions[2 * vertex + 1];
      const x2 = projectedPositions[2 * next];
      const y2 = projectedPositions[2 * next + 1];
      segmentStarts[segment] = vertex;
      segmentEnds[segment] = next;

      bush.add(
        Math.min(lng1, lng2),
        Math.min(lat1, lat2),
        Math.max(lng1, lng2),
        Math.max(lat1, lat2),
      );
      const tileX1 = Math.floor(x1 * tileCount);
      const tileY1 = Math.floor(y1 * tileCount);
      const tileX2 = Math.floor(x2 * tileCount);
      const tileY2 = Math.floor(y2 * tileCount);
      if (Math.max(Math.abs(tileX2 - tileX1), Math.abs(tileY2 - tileY1)) > 1) {
        longCount++;
      } else {
        const tileX = Math.max(0, Math.min(tileCount - 1, Math.floor(((x1 + x2) / 2) * tileCount)));
        const tileY = Math.max(0, Math.min(tileCount - 1, Math.floor(((y1 + y2) / 2) * tileCount)));
        const tile = tileY * tileCount + tileX;
        tileCounts.set(tile, (tileCounts.get(tile) || 0) + 1);
      }
      segment++;
    }
  }
  bush.finish();

  const sortedTiles = Array.from(tileCounts.entries()).sort((a, b) => a[0] - b[0]);
  const regularCount = segmentCount - longCount;
  const regularSegments = new Float32Array(regularCount * FLOATS_PER_SEGMENT);
  const tileRanges = new Map();
  const tileCursors = new Map();
  let writeIndex = 0;
  for (const [tile, count] of sortedTiles) {
    tileRanges.set(tile, { start: writeIndex, count });
    tileCursors.set(tile, writeIndex);
    writeIndex += count;
  }
  const longVertices = new Float32Array(longCount * FLOATS_PER_SEGMENT);
  const longIndex = longCount ? new Flatbush(longCount, 16, Float32Array) : null;
  let longOffset = 0;

  for (let i = 0; i < segmentCount; i++) {
    const start = segmentStarts[i];
    const end = segmentEnds[i];
    const x1 = projectedPositions[2 * start];
    const y1 = projectedPositions[2 * start + 1];
    const x2 = projectedPositions[2 * end];
    const y2 = projectedPositions[2 * end + 1];
    const tileX1 = Math.floor(x1 * tileCount);
    const tileY1 = Math.floor(y1 * tileCount);
    const tileX2 = Math.floor(x2 * tileCount);
    const tileY2 = Math.floor(y2 * tileCount);
    if (Math.max(Math.abs(tileX2 - tileX1), Math.abs(tileY2 - tileY1)) > 1) {
      const lng1 = positions[2 * start];
      const lat1 = positions[2 * start + 1];
      const lng2 = positions[2 * end];
      const lat2 = positions[2 * end + 1];
      longIndex.add(
        Math.min(lng1, lng2),
        Math.min(lat1, lat2),
        Math.max(lng1, lng2),
        Math.max(lat1, lat2),
      );
      writeSegment(longVertices, FLOATS_PER_SEGMENT * longOffset++, x1, y1, x2, y2);
      continue;
    }
    const tileX = Math.max(0, Math.min(tileCount - 1, Math.floor(((x1 + x2) / 2) * tileCount)));
    const tileY = Math.max(0, Math.min(tileCount - 1, Math.floor(((y1 + y2) / 2) * tileCount)));
    const tile = tileY * tileCount + tileX;
    const target = tileCursors.get(tile);
    tileCursors.set(tile, target + 1);
    writeSegment(regularSegments, FLOATS_PER_SEGMENT * target, x1, y1, x2, y2);
  }
  if (longIndex) longIndex.finish();

  return {
    regularSegments,
    longVertices,
    tileRanges,
    tileCount,
    longIndex,
    bush,
    segmentStarts,
    segmentEnds,
    segmentCount,
    longCount,
    stride,
    tileZoom,
  };
}

function createLayer(id, color, positions, startIndices) {
  const projectedPositions = new Float32Array(positions.length);
  for (let vertex = 0; vertex < positions.length / 2; vertex++) {
    const lng = positions[2 * vertex];
    projectedPositions[2 * vertex] = (lng + 180) / 360;
    projectedPositions[2 * vertex + 1] = projectLatitude(positions[2 * vertex + 1]);
  }

  const lods = LOD_STRIDES.map((stride, index) =>
    createSegmentData(positions, projectedPositions, startIndices, stride, LOD_TILE_ZOOMS[index]),
  ).filter(Boolean);
  if (!lods.length) return null;

  let map;
  let program;
  let cornerBuffer;
  let attributes;
  let uniforms;
  let lastBoundsKey = '';
  let visibleRanges = [];
  let visibleLong = new Uint32Array(0);
  let visibleLongCount = 0;
  let longBufferDirty = true;
  let longBufferLod = -1;
  const longScratch = lods.map((lod) => new Float32Array(lod.longCount * FLOATS_PER_SEGMENT));

  const layer = {
    id,
    type: 'custom',
    renderingMode: '2d',
    onAdd(mapInstance, gl) {
      map = mapInstance;
      program = createProgram(gl, vertexShader, fragmentShader);
      cornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
      for (const lod of lods) {
        lod.segmentBuffer = gl.createBuffer();
        lod.longBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, lod.segmentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, lod.regularSegments, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, lod.longBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, lod.longVertices.byteLength, gl.DYNAMIC_DRAW);
        lod.regularSegments = null;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      attributes = {
        startHigh: gl.getAttribLocation(program, 'a_startHigh'),
        startLow: gl.getAttribLocation(program, 'a_startLow'),
        endHigh: gl.getAttribLocation(program, 'a_endHigh'),
        endLow: gl.getAttribLocation(program, 'a_endLow'),
        corner: gl.getAttribLocation(program, 'a_corner'),
      };
      uniforms = {
        matrix: gl.getUniformLocation(program, 'u_matrix'),
        originHigh: gl.getUniformLocation(program, 'u_originHigh'),
        originLow: gl.getUniformLocation(program, 'u_originLow'),
        originClip: gl.getUniformLocation(program, 'u_originClip'),
        viewport: gl.getUniformLocation(program, 'u_viewport'),
        lineWidth: gl.getUniformLocation(program, 'u_lineWidth'),
        color: gl.getUniformLocation(program, 'u_color'),
      };
    },
    render(gl, matrix) {
      const zoom = map.getZoom();
      const lodIndex = getLodIndex(zoom);
      const lod = lods[lodIndex];
      const width = Math.max(0.5, Math.min(8, 0.5 + ((zoom - 6) / 12) * 7.5));
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      const bounds = map.getBounds();
      const tileCount = lod.tileCount;
      let minX = Math.floor(((bounds.getWest() + 180) / 360) * tileCount) - BIN_BUFFER;
      let maxX = Math.floor(((bounds.getEast() + 180) / 360) * tileCount) + BIN_BUFFER;
      let minY = Math.floor(projectPosition(0, bounds.getNorth())[1] * tileCount) - BIN_BUFFER;
      const maxY = Math.min(
        tileCount - 1,
        Math.floor(projectPosition(0, bounds.getSouth())[1] * tileCount) + BIN_BUFFER,
      );
      if (bounds.getEast() - bounds.getWest() >= 360 || minX < 0 || maxX >= tileCount) {
        minX = 0;
        maxX = tileCount - 1;
      }
      minY = Math.max(0, minY);
      if (maxY < minY) return;
      const boundsKey = [lodIndex, minX, maxX, minY, maxY].join(':');
      if (boundsKey !== lastBoundsKey) {
        visibleRanges.length = 0;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const range = lod.tileRanges.get(y * tileCount + x);
            if (!range) continue;
            const previous = visibleRanges[visibleRanges.length - 1];
            if (previous && previous.start + previous.count === range.start)
              previous.count += range.count;
            else visibleRanges.push({ start: range.start, count: range.count });
          }
        }
        visibleLong =
          lod.longIndex && bounds.getEast() - bounds.getWest() < 360
            ? lod.longIndex.search(
                bounds.getWest() - 360 / tileCount,
                Math.max(-85.051129, bounds.getSouth() - 180 / tileCount),
                bounds.getEast() + 360 / tileCount,
                Math.min(85.051129, bounds.getNorth() + 180 / tileCount),
              )
            : new Uint32Array(0);
        visibleLongCount = visibleLong.length;
        longBufferDirty = true;
        longBufferLod = lodIndex;
        lastBoundsKey = boundsKey;
      }

      const segmentStride = FLOATS_PER_SEGMENT * Float32Array.BYTES_PER_ELEMENT;
      const segmentAttributes = [
        [attributes.startHigh, 0],
        [attributes.startLow, 2 * Float32Array.BYTES_PER_ELEMENT],
        [attributes.endHigh, 4 * Float32Array.BYTES_PER_ELEMENT],
        [attributes.endLow, 6 * Float32Array.BYTES_PER_ELEMENT],
      ];
      const bindSegments = (buffer, byteOffset = 0) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        for (const [attribute, offset] of segmentAttributes) {
          gl.enableVertexAttribArray(attribute);
          gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, segmentStride, byteOffset + offset);
          gl.vertexAttribDivisor(attribute, 1);
        }
      };

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
      gl.enableVertexAttribArray(attributes.corner);
      gl.vertexAttribPointer(attributes.corner, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(attributes.corner, 0);
      gl.uniformMatrix4fv(uniforms.matrix, false, matrix);
      const center = projectPosition(map.getCenter().lng, map.getCenter().lat);
      const originHigh = center.map(Math.fround);
      const originLow = center.map((value, index) => value - originHigh[index]);
      const originClip = new Float32Array(4);
      for (let column = 0; column < 4; column++) {
        originClip[column] =
          matrix[column] * center[0] + matrix[4 + column] * center[1] + matrix[12 + column];
      }
      gl.uniform2f(uniforms.originHigh, originHigh[0], originHigh[1]);
      gl.uniform2f(uniforms.originLow, originLow[0], originLow[1]);
      gl.uniform4fv(uniforms.originClip, originClip);
      gl.uniform2f(uniforms.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(uniforms.lineWidth, width * pixelRatio);
      gl.uniform4f(uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);

      for (const range of visibleRanges) {
        bindSegments(lod.segmentBuffer, range.start * segmentStride);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, CORNERS_PER_SEGMENT, range.count);
      }

      if (visibleLongCount) {
        if (longBufferDirty || longBufferLod !== lodIndex) {
          const scratch = longScratch[lodIndex];
          let target = 0;
          for (const candidate of visibleLong) {
            const start = candidate * FLOATS_PER_SEGMENT;
            scratch.set(lod.longVertices.subarray(start, start + FLOATS_PER_SEGMENT), target);
            target += FLOATS_PER_SEGMENT;
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, lod.longBuffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, target));
          longBufferDirty = false;
          longBufferLod = lodIndex;
        }
        bindSegments(lod.longBuffer);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, CORNERS_PER_SEGMENT, visibleLongCount);
      }

      for (const [attribute] of segmentAttributes) gl.vertexAttribDivisor(attribute, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    onRemove(_, gl) {
      for (const lod of lods) {
        gl.deleteBuffer(lod.segmentBuffer);
        gl.deleteBuffer(lod.longBuffer);
      }
      gl.deleteBuffer(cornerBuffer);
      gl.deleteProgram(program);
      cornerBuffer = null;
      program = null;
      map = null;
    },
  };
  return { layer, lods };
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

export function useRendererWay(map) {
  const popup = new Popup({ closeButton: false, closeOnClick: false });
  const layers = new Map();

  const getLod = (lods) => lods[getLodIndex(map.getZoom())];

  const findWay = (point) => {
    const corners = [
      map.unproject([point.x - 12, point.y - 12]),
      map.unproject([point.x + 12, point.y - 12]),
      map.unproject([point.x - 12, point.y + 12]),
      map.unproject([point.x + 12, point.y + 12]),
    ];
    const west = Math.min(...corners.map(({ lng }) => lng));
    const east = Math.max(...corners.map(({ lng }) => lng));
    const south = Math.min(...corners.map(({ lat }) => lat));
    const north = Math.max(...corners.map(({ lat }) => lat));
    let nearest = null;

    for (const [id, entry] of layers) {
      const lod = getLod(entry.lods);
      for (const segment of lod.bush.search(west, south, east, north)) {
        const start = lod.segmentStarts[segment];
        const end = lod.segmentEnds[segment];
        const a = map.project([entry.positions[2 * start], entry.positions[2 * start + 1]]);
        const b = map.project([entry.positions[2 * end], entry.positions[2 * end + 1]]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(
                0,
                Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
              );
        const x = a.x + t * dx;
        const y = a.y + t * dy;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < (nearest?.distance ?? Infinity)) {
          nearest = {
            id,
            name: entry.name,
            coordinates: map.unproject([x, y]).toArray(),
            distance,
          };
        }
      }
    }
    return nearest && nearest.distance <= 6 ? nearest : null;
  };

  const onClick = (event) => {
    if (event.defaultPrevented) return;
    const way = findWay(event.point);
    if (way == null) {
      popup.remove();
      return;
    }
    event.preventDefault();
    popup.setHTML(
      `<a href="${satelliteUrl(way.coordinates)}" target="_blank" rel="noopener noreferrer" class="underline">${escapeHtml(way.name)}</a>`,
    );
    popup.setLngLat(way.coordinates).addTo(map);
  };

  const onMouseMove = (event) => {
    map.getCanvas().classList.toggle('way-hover', !map.isMoving() && findWay(event.point));
  };

  map.on('click', onClick);
  map.on('mousemove', onMouseMove);

  const addLayer = ({ id, name, color, positions, startIndices, beforeId }) => {
    const result = createLayer(id, color, positions, startIndices);
    removeLayer(id);
    if (result == null) return;
    if (beforeId && map.getLayer(beforeId)) map.addLayer(result.layer, beforeId);
    else map.addLayer(result.layer);
    layers.set(id, { ...result, name, positions, startIndices });
  };

  const removeLayer = (id) => {
    if (!layers.delete(id)) return;
    popup.remove();
    if (map.getLayer(id)) map.removeLayer(id);
  };

  const dispose = () => {
    for (const id of layers.keys()) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    layers.clear();
    popup.remove();
    map.off('click', onClick);
    map.off('mousemove', onMouseMove);
    map.getCanvas().classList.remove('way-hover');
  };

  return { addLayer, removeLayer, dispose };
}
