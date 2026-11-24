import { createProgram } from '@/utils/gl';
import { satelliteUrl } from '@/utils/google';
import { mapRange } from '@/utils/numeric';
import Flatbush from 'flatbush';
import { MercatorCoordinate, Popup } from 'mapbox-gl';

const vertexShader = `#version 300 es
  in vec2 a_positionHigh;
  in vec2 a_positionLow;
  uniform mat4 u_matrix;
  uniform vec2 u_originHigh;
  uniform vec2 u_originLow;
  uniform vec4 u_originClip;
  uniform float u_pointSize;

  void main() {
    vec2 offsetHigh = a_positionHigh - u_originHigh;
    vec2 offsetLow = a_positionLow - u_originLow;
    vec4 offsetClip = u_matrix * vec4(offsetHigh, 0.0, 0.0)
      + u_matrix * vec4(offsetLow, 0.0, 0.0);
    gl_Position = u_originClip + offsetClip;
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

function createPositionBuffer(positions) {
  const count = positions.length / 2;
  const gpuPositions = new Float32Array(4 * count);
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };

  for (let i = 0; i < count; i++) {
    const lng = positions[2 * i];
    const lat = positions[2 * i + 1];
    const { x, y } = MercatorCoordinate.fromLngLat([lng, lat]);
    const highX = Math.fround(x);
    const highY = Math.fround(y);
    const offset = 4 * i;
    gpuPositions[offset] = highX;
    gpuPositions[offset + 1] = highY;
    gpuPositions[offset + 2] = x - highX;
    gpuPositions[offset + 3] = y - highY;
    bounds.west = Math.min(bounds.west, lng);
    bounds.south = Math.min(bounds.south, lat);
    bounds.east = Math.max(bounds.east, lng);
    bounds.north = Math.max(bounds.north, lat);
  }

  return { gpuPositions, bounds };
}

function intersectsViewport(layerBounds, viewport) {
  const south = viewport.getSouth();
  const north = viewport.getNorth();
  if (layerBounds.north < south || layerBounds.south > north) return false;

  const west = viewport.getWest();
  let east = viewport.getEast();
  if (east < west) east += 360;
  if (east - west >= 360) return true;

  const viewportCenter = (west + east) / 2;
  const layerCenter = (layerBounds.west + layerBounds.east) / 2;
  const nearestWorldOffset = Math.round((viewportCenter - layerCenter) / 360) * 360;

  return [-360, 0, 360].some((offset) => {
    const shiftedWest = layerBounds.west + nearestWorldOffset + offset;
    const shiftedEast = layerBounds.east + nearestWorldOffset + offset;
    return shiftedEast >= west && shiftedWest <= east;
  });
}

function createLayer(id, color, positions) {
  const count = positions.length / 2;
  if (count === 0) return null;

  const index = new Flatbush(count, 16, Float32Array);
  for (let i = 0; i < count; i++) {
    index.add(positions[2 * i], positions[2 * i + 1]);
  }
  index.finish();

  const { gpuPositions, bounds: layerBounds } = createPositionBuffer(positions);
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
      program = createProgram(gl, vertexShader, fragmentShader);
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
        originHigh: gl.getUniformLocation(program, 'u_originHigh'),
        originLow: gl.getUniformLocation(program, 'u_originLow'),
        originClip: gl.getUniformLocation(program, 'u_originClip'),
        pointSize: gl.getUniformLocation(program, 'u_pointSize'),
        color: gl.getUniformLocation(program, 'u_color'),
      };
    },
    render(gl, matrix) {
      const scale = getScale(map.getZoom());
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      const bounds = map.getBounds();
      if (!intersectsViewport(layerBounds, bounds)) {
        return;
      }

      const maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attributes.positionHigh);
      gl.enableVertexAttribArray(attributes.positionLow);
      gl.vertexAttribDivisor(attributes.positionHigh, 0);
      gl.vertexAttribDivisor(attributes.positionLow, 0);
      gl.vertexAttribPointer(attributes.positionHigh, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(attributes.positionLow, 2, gl.FLOAT, false, 16, 8);
      gl.uniformMatrix4fv(uniforms.matrix, false, matrix);
      const center = MercatorCoordinate.fromLngLat(map.getCenter());
      const centerX = center.x;
      const centerY = center.y;
      const originHigh = [Math.fround(centerX), Math.fround(centerY)];
      const originLow = [centerX - originHigh[0], centerY - originHigh[1]];
      const originClip = new Float32Array(4);
      for (let column = 0; column < 4; column++) {
        originClip[column] =
          matrix[column] * centerX + matrix[4 + column] * centerY + matrix[12 + column];
      }
      gl.uniform2f(uniforms.originHigh, originHigh[0], originHigh[1]);
      gl.uniform2f(uniforms.originLow, originLow[0], originLow[1]);
      gl.uniform4fv(uniforms.originClip, originClip);
      gl.uniform1f(uniforms.pointSize, Math.min(4 * scale * pixelRatio, maxPointSize));
      gl.uniform4f(uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);
      gl.drawArrays(gl.POINTS, 0, count);
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

function getScale(zoom) {
  return mapRange(zoom, 6, 18, 0.5, 8);
}

export function useRendererPoi(map) {
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

    return nearest && nearest.distance <= 2 * getScale(map.getZoom()) + 3 ? nearest : null;
  };

  const onClick = (event) => {
    const poi = findPoi(event.point);
    if (poi == null) {
      if (!event.defaultPrevented) popup.remove();
      return;
    }

    const [name, openingHours] = poi.metadata[poi.candidate] ?? [];
    popup.setHTML(`
      <a href="${satelliteUrl(poi.coordinates)}" target="_blank" class="underline">
        ${name || poi.name}
      </a>
      ${openingHours ? `<br>Opening hours: ${openingHours}` : ''}
    `);
    popup.setLngLat(poi.coordinates).addTo(map);
  };

  const onMouseMove = (event) => {
    if (map.isMoving()) {
      return;
    }

    map.getCanvas().style.cursor = findPoi(event.point) ? 'pointer' : '';
  };

  map.on('click', onClick);
  map.on('mousemove', onMouseMove);

  const addLayer = ({ id, name, color, positions, metadata, beforeId }) => {
    const result = createLayer(id, color, positions);
    removeLayer(id);
    if (result == null) return;

    if (beforeId && map.getLayer(beforeId)) {
      map.addLayer(result.layer, beforeId);
    } else {
      map.addLayer(result.layer);
    }
    layers.set(id, { ...result, name, metadata, positions });
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
    map.getCanvas().style.cursor = '';
  };

  return { addLayer, removeLayer, dispose };
}
