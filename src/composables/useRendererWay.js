import { createProgram } from '@/utils/gl';
import { satelliteUrl } from '@/utils/googleMaps';
import { intersects } from '@/utils/mapbox';
import { mapRange } from '@/utils/numeric';
import Flatbush from 'flatbush';
import { LngLatBounds, MercatorCoordinate, Popup } from 'mapbox-gl';
import simplify from 'simplify-js';

const FLOATS_PER_SEGMENT = 8;
const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
const CORNERS_PER_TRIANGLE = CORNERS.length / 2;

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

function simplifiedIndices(projectedPositions, start, end, tolerance) {
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

function createSegments(positions, projectedPositions, startIndices, zoom) {
  let segmentCount = 0;

  const lines = [];
  const tolerance = 1 / (512 * 2 ** zoom);
  for (let startIndex = 0; startIndex < startIndices.length - 1; startIndex++) {
    const indices = simplifiedIndices(
      projectedPositions,
      startIndices[startIndex],
      startIndices[startIndex + 1],
      tolerance,
    );
    lines.push(indices);
    segmentCount += indices.length - 1;
  }

  const segments = new Float32Array(segmentCount * FLOATS_PER_SEGMENT);
  const segmentStartIndices = new Uint32Array(segmentCount);
  const segmentEndIndices = new Uint32Array(segmentCount);
  const index = new Flatbush(segmentCount, 16, Float32Array);

  let segment = 0;
  for (const indices of lines) {
    for (let i = 0; i < indices.length - 1; i++) {
      const start = indices[i];
      const end = indices[i + 1];
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

  return { segments, segmentStartIndices, segmentEndIndices, segmentCount, index, zoom };
}

function getLineWidth(zoom) {
  return mapRange(zoom, 6, 18, 0.5, 8);
}

function createLayer(id, name, color, positions, startIndices) {
  const projectedPositions = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 2; i++) {
    const coordinates = [positions[2 * i], positions[2 * i + 1]];
    const { x, y } = MercatorCoordinate.fromLngLat(coordinates);
    projectedPositions[2 * i] = x;
    projectedPositions[2 * i + 1] = y;
  }

  const lods = [7, 10, 22].map((zoom) =>
    createSegments(positions, projectedPositions, startIndices, zoom),
  );

  const bounds = new LngLatBounds(
    [lods[0].index.minX, lods[0].index.minY],
    [lods[0].index.maxX, lods[0].index.maxY],
  );

  return {
    id,
    type: 'custom',
    renderingMode: '2d',

    name,
    lods,
    bounds,
    positions,
    startIndices,

    map: null,
    program: null,
    cornerBuffer: null,
    attributes: null,
    uniforms: null,

    get lod() {
      const zoom = this.map.getZoom();
      for (const lod of this.lods) {
        if (zoom <= lod.zoom) {
          return lod;
        }
      }
      return this.lods[0];
    },

    onAdd(map, gl) {
      this.map = map;
      this.program = createProgram(gl, vertexShader, fragmentShader);

      this.cornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);

      for (const lod of this.lods) {
        lod.segmentBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, lod.segmentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, lod.segments, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }

      this.attributes = {
        startHi: gl.getAttribLocation(this.program, 'a_startHi'),
        startLo: gl.getAttribLocation(this.program, 'a_startLo'),
        endHi: gl.getAttribLocation(this.program, 'a_endHi'),
        endLo: gl.getAttribLocation(this.program, 'a_endLo'),
        corner: gl.getAttribLocation(this.program, 'a_corner'),
      };

      this.uniforms = {
        matrix: gl.getUniformLocation(this.program, 'u_matrix'),
        originHi: gl.getUniformLocation(this.program, 'u_originHi'),
        originLo: gl.getUniformLocation(this.program, 'u_originLo'),
        originClip: gl.getUniformLocation(this.program, 'u_originClip'),
        viewport: gl.getUniformLocation(this.program, 'u_viewport'),
        lineWidth: gl.getUniformLocation(this.program, 'u_lineWidth'),
        color: gl.getUniformLocation(this.program, 'u_color'),
      };
    },

    render(gl, matrix) {
      if (!intersects(this.map.getBounds(), this.bounds)) {
        return;
      }

      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
      gl.enableVertexAttribArray(this.attributes.corner);
      gl.vertexAttribPointer(this.attributes.corner, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(this.attributes.corner, 0);
      gl.uniformMatrix4fv(this.uniforms.matrix, false, matrix);

      const { x, y } = MercatorCoordinate.fromLngLat(this.map.getCenter());
      const center = [x, y];
      const originHi = center.map(Math.fround);
      const originLo = center.map((value, index) => value - originHi[index]);
      const originClip = new Float32Array(4);
      for (let column = 0; column < 4; column++) {
        originClip[column] =
          matrix[column] * center[0] + matrix[4 + column] * center[1] + matrix[12 + column];
      }

      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      const lineWidth = getLineWidth(this.map.getZoom()) * pixelRatio;

      gl.uniform2f(this.uniforms.originHi, originHi[0], originHi[1]);
      gl.uniform2f(this.uniforms.originLo, originLo[0], originLo[1]);
      gl.uniform4fv(this.uniforms.originClip, originClip);
      gl.uniform2f(this.uniforms.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(this.uniforms.lineWidth, lineWidth);
      gl.uniform4f(this.uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);

      const lod = this.lod;
      const attributes = [
        this.attributes.startHi,
        this.attributes.startLo,
        this.attributes.endHi,
        this.attributes.endLo,
      ];

      gl.bindBuffer(gl.ARRAY_BUFFER, lod.segmentBuffer);
      for (const [index, attribute] of attributes.entries()) {
        const stride = FLOATS_PER_SEGMENT * Float32Array.BYTES_PER_ELEMENT;
        const offset = index * 2 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, stride, offset);
        gl.vertexAttribDivisor(attribute, 1);
      }
      gl.drawArraysInstanced(gl.TRIANGLES, 0, CORNERS_PER_TRIANGLE, lod.segmentCount);

      for (const attribute of attributes) {
        gl.vertexAttribDivisor(attribute, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },

    onRemove(_, gl) {
      for (const lod of this.lods) {
        gl.deleteBuffer(lod.segmentBuffer);
      }
      gl.deleteBuffer(this.cornerBuffer);
      gl.deleteProgram(this.program);
    },
  };
}

export function useRendererWay(map) {
  const layers = new Map();
  const popup = new Popup({ closeButton: false, closeOnClick: false });

  const findWay = (point) => {
    const northEast = map.unproject([point.x - 32, point.y - 32]);
    const southWest = map.unproject([point.x + 32, point.y + 32]);

    let nearest = null;
    for (const layer of layers.values()) {
      const lod = layer.lod;
      for (const index of lod.index.search(
        northEast.lng,
        southWest.lat,
        southWest.lng,
        northEast.lat,
      )) {
        const start = lod.segmentStartIndices[index];
        const end = lod.segmentEndIndices[index];
        const a = map.project([layer.positions[2 * start], layer.positions[2 * start + 1]]);
        const b = map.project([layer.positions[2 * end], layer.positions[2 * end + 1]]);
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
        if (nearest == null || distance < nearest.distance) {
          nearest = { index, coordinates: map.unproject([x, y]).toArray(), distance, layer };
        }
      }
    }
    return nearest && nearest.distance <= 6 ? nearest : null;
  };

  const onClick = (event) => {
    const way = findWay(event.point);
    if (way == null) {
      popup.remove();
      return;
    }

    popup.setHTML(`
      <a href="${satelliteUrl(way.coordinates)}" target="_blank" class="underline">
        ${way.layer.name}
      </a>
    `);
    popup.setLngLat(way.coordinates);
    popup.addTo(map);
  };

  const onMouseMove = (event) => {
    map.getCanvas().classList.toggle('way-hover', !map.isMoving() && findWay(event.point));
  };

  map.on('click', onClick);
  map.on('mousemove', onMouseMove);

  const addLayer = ({ id, name, color, positions, startIndices, beforeId }) => {
    removeLayer(id);

    const layer = createLayer(id, name, color, positions, startIndices);
    map.addLayer(layer, beforeId);

    layers.set(id, layer);
  };

  const removeLayer = (id) => {
    if (!layers.delete(id)) {
      return;
    }

    popup.remove();
    map.removeLayer(id);
  };

  const dispose = () => {
    for (const id of layers.keys()) {
      removeLayer(id);
    }

    map.off('click', onClick);
    map.off('mousemove', onMouseMove);
    map.getCanvas().classList.remove('way-hover');
  };

  return { addLayer, removeLayer, dispose };
}
