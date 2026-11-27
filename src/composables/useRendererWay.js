import { createProgram } from '@/utils/gl';
import { satelliteUrl } from '@/utils/googleMaps';
import { roundTo } from '@/utils/numeric';
import Flatbush from 'flatbush';
import { LngLatBounds, MercatorCoordinate, Popup } from 'mapbox-gl';
import simplify from 'simplify-js';

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
const FLOATS_PER_SEGMENT = 8;
// Douglas–Peucker tolerances in normalized Mercator units: 0.5px at zoom 8, then 2px at zoom 6.
const LOD_TOLERANCES = [0, 0.5 / (512 * 2 ** 8), 2 / (512 * 2 ** 6)];
const LOD_ZOOMS = [10, 6];

function getLodIndex(zoom) {
  if (zoom >= LOD_ZOOMS[0]) return 0;
  if (zoom <= LOD_ZOOMS[1]) return 2;
  return 1;
}

const vertexShader = `#version 300 es
  in vec2 a_startHi;
  in vec2 a_startLo;
  in vec2 a_endHi;
  in vec2 a_endLo;
  in vec2 a_corner;
  uniform mat4 u_matrix;
  uniform vec2 u_originHi;
  uniform vec2 u_originLo;
  uniform vec4 u_originClip;
  uniform vec2 u_viewport;
  uniform highp float u_lineWidth;
  out vec2 v_start;
  out vec2 v_end;

  void main() {
    vec2 startHi = a_startHi - u_originHi;
    vec2 startLo = a_startLo - u_originLo;
    vec2 endHi = a_endHi - u_originHi;
    vec2 endLo = a_endLo - u_originLo;
    vec4 startClip = u_originClip + u_matrix * vec4(startHi, 0.0, 0.0) + u_matrix * vec4(startLo, 0.0, 0.0);
    vec4 endClip = u_originClip + u_matrix * vec4(endHi, 0.0, 0.0) + u_matrix * vec4(endLo, 0.0, 0.0);
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

function intersects(viewport, bounds) {
  if (bounds.getNorth() < viewport.getSouth() || bounds.getSouth() > viewport.getNorth()) {
    return false;
  }

  const viewportWest = viewport.getWest();
  const viewportEastRaw = viewport.getEast();
  const viewportEast = viewportEastRaw < viewportWest ? viewportEastRaw + 360 : viewportEastRaw;
  const viewportCenter = (viewportWest + viewportEast) / 2;
  if (viewportEast - viewportWest >= 360) {
    return true;
  }

  const boundsWest = bounds.getWest();
  const boundsEast = bounds.getEast();
  const boundsCenter = (boundsWest + boundsEast) / 2;
  const nearestWorldOffset = roundTo(viewportCenter - boundsCenter, 360);
  return (
    boundsEast + nearestWorldOffset >= viewportWest &&
    boundsWest + nearestWorldOffset <= viewportEast
  );
}

function simplifyProjectedPositions(projectedPositions, start, end, tolerance) {
  if (tolerance === 0) {
    return Array.from({ length: end - start }, (_, index) => start + index);
  }

  const vertices = [];
  for (let index = start; index < end; index++) {
    vertices.push({
      x: projectedPositions[2 * index],
      y: projectedPositions[2 * index + 1],
      index,
    });
  }
  return simplify(vertices, tolerance).map(({ index }) => index);
}

function createSegments(positions, projectedPositions, startIndices, tolerance) {
  const lines = [];
  let segmentCount = 0;

  for (let line = 0; line < startIndices.length - 1; line++) {
    const vertices = simplifyProjectedPositions(
      projectedPositions,
      startIndices[line],
      startIndices[line + 1],
      tolerance,
    );
    lines.push(vertices);
    segmentCount += vertices.length - 1;
  }

  const segments = new Float32Array(segmentCount * FLOATS_PER_SEGMENT);
  const segmentStartIndices = new Uint32Array(segmentCount);
  const segmentEndIndices = new Uint32Array(segmentCount);
  const index = new Flatbush(segmentCount, 16, Float32Array);

  let segment = 0;
  for (const vertices of lines) {
    for (let i = 0; i < vertices.length - 1; i++) {
      const start = vertices[i];
      const end = vertices[i + 1];
      segmentStartIndices[segment] = start;
      segmentEndIndices[segment] = end;

      const x1 = projectedPositions[2 * start];
      const y1 = projectedPositions[2 * start + 1];
      const x2 = projectedPositions[2 * end];
      const y2 = projectedPositions[2 * end + 1];
      const highX1 = Math.fround(x1);
      const highY1 = Math.fround(y1);
      const highX2 = Math.fround(x2);
      const highY2 = Math.fround(y2);
      const offset = FLOATS_PER_SEGMENT * segment;
      segments[offset] = highX1;
      segments[offset + 1] = highY1;
      segments[offset + 2] = x1 - highX1;
      segments[offset + 3] = y1 - highY1;
      segments[offset + 4] = highX2;
      segments[offset + 5] = highY2;
      segments[offset + 6] = x2 - highX2;
      segments[offset + 7] = y2 - highY2;
      segment++;

      const lng1 = positions[2 * start];
      const lat1 = positions[2 * start + 1];
      const lng2 = positions[2 * end];
      const lat2 = positions[2 * end + 1];
      index.add(
        Math.min(lng1, lng2),
        Math.min(lat1, lat2),
        Math.max(lng1, lng2),
        Math.max(lat1, lat2),
      );
    }
  }
  index.finish();

  return { segments, segmentStartIndices, segmentEndIndices, segmentCount, index };
}

function createLayer(id, color, positions, startIndices) {
  const projectedPositions = new Float32Array(positions.length);
  for (let vertex = 0; vertex < positions.length / 2; vertex++) {
    const coordinates = [positions[2 * vertex], positions[2 * vertex + 1]];
    const { x, y } = MercatorCoordinate.fromLngLat(coordinates);
    projectedPositions[2 * vertex] = x;
    projectedPositions[2 * vertex + 1] = y;
  }

  const lods = LOD_TOLERANCES.map((tolerance) =>
    createSegments(positions, projectedPositions, startIndices, tolerance),
  );

  const bounds = new LngLatBounds(
    [lods[0].index.minX, lods[0].index.minY],
    [lods[0].index.maxX, lods[0].index.maxY],
  );

  let map;
  let program;
  let cornerBuffer;
  let attributes;
  let uniforms;

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
        gl.bindBuffer(gl.ARRAY_BUFFER, lod.segmentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, lod.segments, gl.STATIC_DRAW);
        lod.segments = null;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      attributes = {
        startHi: gl.getAttribLocation(program, 'a_startHi'),
        startLo: gl.getAttribLocation(program, 'a_startLo'),
        endHi: gl.getAttribLocation(program, 'a_endHi'),
        endLo: gl.getAttribLocation(program, 'a_endLo'),
        corner: gl.getAttribLocation(program, 'a_corner'),
      };
      uniforms = {
        matrix: gl.getUniformLocation(program, 'u_matrix'),
        originHi: gl.getUniformLocation(program, 'u_originHi'),
        originLo: gl.getUniformLocation(program, 'u_originLo'),
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
      if (!intersects(map.getBounds(), bounds)) return;

      const width = Math.max(0.5, Math.min(8, 0.5 + ((zoom - 6) / 12) * 7.5));
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      const segmentStride = FLOATS_PER_SEGMENT * Float32Array.BYTES_PER_ELEMENT;
      const segmentAttributes = [
        [attributes.startHi, 0],
        [attributes.startLo, 2 * Float32Array.BYTES_PER_ELEMENT],
        [attributes.endHi, 4 * Float32Array.BYTES_PER_ELEMENT],
        [attributes.endLo, 6 * Float32Array.BYTES_PER_ELEMENT],
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
      const { x, y } = MercatorCoordinate.fromLngLat(map.getCenter());
      const center = [x, y];
      const originHi = center.map(Math.fround);
      const originLo = center.map((value, index) => value - originHi[index]);
      const originClip = new Float32Array(4);
      for (let column = 0; column < 4; column++) {
        originClip[column] =
          matrix[column] * center[0] + matrix[4 + column] * center[1] + matrix[12 + column];
      }
      gl.uniform2f(uniforms.originHi, originHi[0], originHi[1]);
      gl.uniform2f(uniforms.originLo, originLo[0], originLo[1]);
      gl.uniform4fv(uniforms.originClip, originClip);
      gl.uniform2f(uniforms.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(uniforms.lineWidth, width * pixelRatio);
      gl.uniform4f(uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);

      bindSegments(lod.segmentBuffer);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, CORNERS.length / 2, lod.segmentCount);

      for (const [attribute] of segmentAttributes) gl.vertexAttribDivisor(attribute, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    onRemove(_, gl) {
      for (const lod of lods) {
        gl.deleteBuffer(lod.segmentBuffer);
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
      for (const segment of lod.index.search(west, south, east, north)) {
        const start = lod.segmentStartIndices[segment];
        const end = lod.segmentEndIndices[segment];
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
