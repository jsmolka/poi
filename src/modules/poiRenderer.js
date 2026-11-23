import { satelliteUrl } from '@/utils/google';
import Flatbush from 'flatbush';
import { Popup } from 'mapbox-gl';

const BIN_COUNT = 32;
const BIN_TOTAL = BIN_COUNT * BIN_COUNT;

const vertexShader = `#version 300 es
  in vec2 a_positionHigh;
  in vec2 a_positionLow;
  uniform mat4 u_matrix;
  uniform float u_pointSize;

  void main() {
    gl_Position = u_matrix * vec4(a_positionHigh, 0.0, 1.0) + u_matrix * vec4(a_positionLow, 0.0, 0.0);
    gl_PointSize = u_pointSize;
  }
`;

const fragmentShader = `#version 300 es
  precision mediump float;
  uniform vec4 u_color;
  out vec4 fragColor;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float distanceToEdge = length(point);
    float edgeWidth = fwidth(distanceToEdge);
    float alpha = 1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, distanceToEdge);
    fragColor = vec4(u_color.rgb * alpha, u_color.a * alpha);
  }
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Could not compile POI renderer shader: ${message}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Could not link POI renderer shader: ${message}`);
  }
  return program;
}

function projectPosition(lng, lat) {
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const radians = (clampedLat * Math.PI) / 180;
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2];
}

function createPositionBuffer(positions) {
  const count = positions.length / 2;
  const binCounts = new Uint32Array(BIN_TOTAL);
  const projected = new Float64Array(2 * count);

  for (let i = 0; i < count; i++) {
    const [x, y] = projectPosition(positions[2 * i], positions[2 * i + 1]);
    projected[2 * i] = x;
    projected[2 * i + 1] = y;
    const binX = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(x * BIN_COUNT)));
    const binY = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(y * BIN_COUNT)));
    binCounts[binY * BIN_COUNT + binX]++;
  }

  const binStarts = new Uint32Array(BIN_TOTAL + 1);
  for (let i = 0; i < BIN_TOTAL; i++) {
    binStarts[i + 1] = binStarts[i] + binCounts[i];
  }

  const next = binStarts.slice(0, BIN_TOTAL);
  const gpuPositions = new Float32Array(4 * count);
  for (let i = 0; i < count; i++) {
    const x = projected[2 * i];
    const y = projected[2 * i + 1];
    const binX = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(x * BIN_COUNT)));
    const binY = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(y * BIN_COUNT)));
    const offset = 4 * next[binY * BIN_COUNT + binX]++;
    const highX = Math.fround(x);
    const highY = Math.fround(y);
    gpuPositions[offset] = highX;
    gpuPositions[offset + 1] = highY;
    gpuPositions[offset + 2] = x - highX;
    gpuPositions[offset + 3] = y - highY;
  }

  return { gpuPositions, binStarts };
}

function createPoiLayer({ id, color, positions, beforeId }) {
  const count = positions.length / 2;
  if (count === 0) return null;

  const index = new Flatbush(count, 16, Float32Array);
  for (let i = 0; i < count; i++) {
    index.add(positions[2 * i], positions[2 * i + 1]);
  }
  index.finish();

  const { gpuPositions, binStarts } = createPositionBuffer(positions);
  let map;
  let program;
  let buffer;
  let attributes;
  let uniforms;

  const layer = {
    id,
    type: 'custom',
    renderingMode: '2d',
    onAdd(mapInstance, gl) {
      map = mapInstance;
      program = createProgram(gl);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, gpuPositions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      attributes = {
        positionHigh: gl.getAttribLocation(program, 'a_positionHigh'),
        positionLow: gl.getAttribLocation(program, 'a_positionLow'),
      };
      uniforms = {
        matrix: gl.getUniformLocation(program, 'u_matrix'),
        pointSize: gl.getUniformLocation(program, 'u_pointSize'),
        color: gl.getUniformLocation(program, 'u_color'),
      };
    },
    render(gl, matrix) {
      const zoom = Math.round(map.getZoom() * 4) / 4;
      const scale = Math.max(0.5, Math.min(8, 0.5 + ((zoom - 6) / 12) * 7.5));
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      const maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
      const bounds = map.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      let minX = Math.floor(((west + 180) / 360) * BIN_COUNT) - 1;
      let maxX = Math.floor(((east + 180) / 360) * BIN_COUNT) + 1;
      if (east - west >= 360 || minX < 0 || maxX >= BIN_COUNT) {
        minX = 0;
        maxX = BIN_COUNT - 1;
      }
      const minY = Math.max(0, Math.floor(projectPosition(0, north)[1] * BIN_COUNT) - 1);
      const maxY = Math.min(
        BIN_COUNT - 1,
        Math.floor(projectPosition(0, south)[1] * BIN_COUNT) + 1,
      );

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attributes.positionHigh);
      gl.enableVertexAttribArray(attributes.positionLow);
      gl.vertexAttribDivisor(attributes.positionHigh, 0);
      gl.vertexAttribDivisor(attributes.positionLow, 0);
      gl.vertexAttribPointer(attributes.positionHigh, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(attributes.positionLow, 2, gl.FLOAT, false, 16, 8);
      gl.uniformMatrix4fv(uniforms.matrix, false, matrix);
      gl.uniform1f(uniforms.pointSize, Math.min(4 * scale * pixelRatio, maxPointSize));
      gl.uniform4f(uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);
      for (let y = minY; y <= maxY; y++) {
        const start = binStarts[y * BIN_COUNT + minX];
        const end = binStarts[y * BIN_COUNT + maxX + 1];
        if (end > start) gl.drawArrays(gl.POINTS, start, end - start);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    onRemove(_, gl) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      buffer = null;
      program = null;
      map = null;
    },
  };

  return { layer, index };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character];
  });
}

function pointScale(map) {
  const zoom = Math.round(map.getZoom() * 4) / 4;
  return Math.max(0.5, Math.min(8, 0.5 + ((zoom - 6) / 12) * 7.5));
}

export function usePoiRenderer(map) {
  const popup = new Popup({ closeButton: false, closeOnClick: false });
  const layers = new Map();

  const findPoi = (point) => {
    if (map.getZoom() < 8) return null;

    const corners = [
      map.unproject([point.x - 24, point.y - 24]),
      map.unproject([point.x + 24, point.y - 24]),
      map.unproject([point.x - 24, point.y + 24]),
      map.unproject([point.x + 24, point.y + 24]),
    ];
    const west = Math.min(...corners.map(({ lng }) => lng));
    const east = Math.max(...corners.map(({ lng }) => lng));
    const south = Math.min(...corners.map(({ lat }) => lat));
    const north = Math.max(...corners.map(({ lat }) => lat));
    let nearest = null;

    for (const [id, entry] of layers) {
      for (const candidate of entry.index.search(west, south, east, north)) {
        const coordinates = [entry.positions[2 * candidate], entry.positions[2 * candidate + 1]];
        const screen = map.project(coordinates);
        const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
        if (distance < (nearest?.distance ?? Infinity)) {
          nearest = { id, ...entry, candidate, coordinates, distance };
        }
      }
    }

    return nearest && nearest.distance <= 2 * pointScale(map) + 3 ? nearest : null;
  };

  const onClick = (event) => {
    const poi = findPoi(event.point);
    if (poi == null) {
      if (!event.defaultPrevented) popup.remove();
      return;
    }

    const [name, openingHours] = poi.metadata[poi.candidate] ?? [];
    popup.setHTML(`
      <a href="${satelliteUrl(poi.coordinates)}" target="_blank" rel="noopener noreferrer" class="underline">
        ${name ? escapeHtml(name) : escapeHtml(poi.name)}
      </a>
      ${openingHours ? `<br>Opening hours: ${escapeHtml(openingHours)}` : ''}
    `);
    popup.setLngLat(poi.coordinates).addTo(map);
  };

  let lastPointer;
  let hoverFrame;

  const updateCursor = () => {
    hoverFrame = null;
    if (lastPointer && !map.isMoving()) {
      map.getCanvasContainer().style.cursor = findPoi(lastPointer) ? 'pointer' : '';
    }
  };

  const onMouseMove = (event) => {
    lastPointer = event.point;
    if (map.isMoving() || event.originalEvent?.buttons !== 0 || hoverFrame != null) return;
    hoverFrame = requestAnimationFrame(updateCursor);
  };

  const onMoveEnd = () => {
    if (lastPointer && hoverFrame == null) hoverFrame = requestAnimationFrame(updateCursor);
  };

  map.on('click', onClick);
  map.on('mousemove', onMouseMove);
  map.on('moveend', onMoveEnd);

  const addLayerPoi = ({ id, name, color, positions, metadata, beforeId }) => {
    const result = createPoiLayer({ id, color, positions, beforeId });
    removeLayerPoi(id);
    if (result == null) return;

    if (beforeId && map.getLayer(beforeId)) {
      map.addLayer(result.layer, beforeId);
    } else {
      map.addLayer(result.layer);
    }
    layers.set(id, { ...result, name, metadata, positions });
  };

  const removeLayerPoi = (id) => {
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
    map.off('moveend', onMoveEnd);
    if (hoverFrame != null) cancelAnimationFrame(hoverFrame);
    map.getCanvasContainer().style.cursor = '';
  };

  return { addLayerPoi, removeLayerPoi, dispose };
}
