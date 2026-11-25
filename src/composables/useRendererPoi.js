import { createProgram } from '@/utils/gl';
import { satelliteUrl } from '@/utils/google';
import { mapRange } from '@/utils/numeric';
import Flatbush from 'flatbush';
import { LngLatBounds, MercatorCoordinate, Popup } from 'mapbox-gl';

const vertexShader = `#version 300 es
  in vec2 a_positionHi;
  in vec2 a_positionLo;
  uniform mat4 u_matrix;
  uniform vec2 u_originHi;
  uniform vec2 u_originLo;
  uniform vec4 u_originClip;
  uniform float u_pointSize;

  void main() {
    vec2 offsetHi = a_positionHi - u_originHi;
    vec2 offsetLo = a_positionLo - u_originLo;
    vec4 offsetClip = u_matrix * vec4(offsetHi, 0.0, 0.0) + u_matrix * vec4(offsetLo, 0.0, 0.0);
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
  const vertices = positions.length / 2;
  const positionBuffer = new Float32Array(4 * vertices);
  const bounds = new LngLatBounds();

  for (let vertex = 0; vertex < vertices; vertex++) {
    const coordinates = [positions[2 * vertex], positions[2 * vertex + 1]];
    const { x, y } = MercatorCoordinate.fromLngLat(coordinates);
    const highX = Math.fround(x);
    const highY = Math.fround(y);

    positionBuffer[4 * vertex] = highX;
    positionBuffer[4 * vertex + 1] = highY;
    positionBuffer[4 * vertex + 2] = x - highX;
    positionBuffer[4 * vertex + 3] = y - highY;
    bounds.extend(coordinates);
  }
  return { positionBuffer, bounds };
}

function boundsIntersect(bounds, viewport) {
  if (bounds.getNorth() < viewport.getSouth() || bounds.getSouth() > viewport.getNorth()) {
    return false;
  }

  const west = viewport.getWest();
  let east = viewport.getEast();
  if (east < west) {
    east += 360;
  } else if (east - west >= 360) {
    return true;
  }

  const boundsWest = bounds.getWest();
  const boundsEast = bounds.getEast();
  const viewportCenter = (west + east) / 2;
  const boundsCenter = (boundsWest + boundsEast) / 2;
  const nearestWorldOffset = Math.round((viewportCenter - boundsCenter) / 360) * 360;

  return [-360, 0, 360].some((offset) => {
    const shiftedWest = boundsWest + nearestWorldOffset + offset;
    const shiftedEast = boundsEast + nearestWorldOffset + offset;
    return shiftedEast >= west && shiftedWest <= east;
  });
}

function createLayer(id, color, positions) {
  const vertices = positions.length / 2;
  const index = new Flatbush(vertices, 16, Float32Array);
  for (let vertex = 0; vertex < vertices; vertex++) {
    index.add(positions[2 * vertex], positions[2 * vertex + 1]);
  }
  index.finish();

  const { positionBuffer, bounds: layerBounds } = createPositionBuffer(positions);
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
      gl.bufferData(gl.ARRAY_BUFFER, positionBuffer, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      attributes = {
        positionHi: gl.getAttribLocation(program, 'a_positionHi'),
        positionLo: gl.getAttribLocation(program, 'a_positionLo'),
      };
      uniforms = {
        matrix: gl.getUniformLocation(program, 'u_matrix'),
        originHi: gl.getUniformLocation(program, 'u_originHi'),
        originLo: gl.getUniformLocation(program, 'u_originLo'),
        originClip: gl.getUniformLocation(program, 'u_originClip'),
        pointSize: gl.getUniformLocation(program, 'u_pointSize'),
        color: gl.getUniformLocation(program, 'u_color'),
      };
    },
    render(gl, matrix) {
      const scale = getScale(map.getZoom());
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      if (!boundsIntersect(layerBounds, map.getBounds())) {
        return;
      }

      const maxPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(attributes.positionHi);
      gl.enableVertexAttribArray(attributes.positionLo);
      gl.vertexAttribDivisor(attributes.positionHi, 0);
      gl.vertexAttribDivisor(attributes.positionLo, 0);
      gl.vertexAttribPointer(attributes.positionHi, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(attributes.positionLo, 2, gl.FLOAT, false, 16, 8);
      gl.uniformMatrix4fv(uniforms.matrix, false, matrix);
      const center = MercatorCoordinate.fromLngLat(map.getCenter());
      const centerX = center.x;
      const centerY = center.y;
      const originHi = [Math.fround(centerX), Math.fround(centerY)];
      const originLo = [centerX - originHi[0], centerY - originHi[1]];
      const originClip = new Float32Array(4);
      for (let column = 0; column < 4; column++) {
        originClip[column] =
          matrix[column] * centerX + matrix[4 + column] * centerY + matrix[12 + column];
      }
      gl.uniform2f(uniforms.originHi, originHi[0], originHi[1]);
      gl.uniform2f(uniforms.originLo, originLo[0], originLo[1]);
      gl.uniform4fv(uniforms.originClip, originClip);
      gl.uniform1f(uniforms.pointSize, Math.min(4 * scale * pixelRatio, maxPointSize));
      gl.uniform4f(uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);
      gl.drawArrays(gl.POINTS, 0, vertices);
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
    const northEast = map.unproject([point.x - 32, point.y - 32]);
    const southWest = map.unproject([point.x + 32, point.y + 32]);

    let nearest = null;
    for (const [id, layer] of layers) {
      for (const candidate of layer.index.search(
        northEast.lng,
        southWest.lat,
        southWest.lng,
        northEast.lat,
      )) {
        const coordinates = [layer.positions[2 * candidate], layer.positions[2 * candidate + 1]];
        const candidatePoint = map.project(coordinates);
        const distance = Math.hypot(candidatePoint.x - point.x, candidatePoint.y - point.y);
        if (nearest == null || distance < nearest.distance) {
          nearest = { id, layer, candidate, coordinates, distance };
        }
      }
    }

    return nearest && nearest.distance <= 2 * getScale(map.getZoom()) ? nearest : null;
  };

  const onClick = (event) => {
    const poi = findPoi(event.point);
    if (poi == null) {
      popup.remove();
      return;
    }

    const [name, openingHours] = poi.layer.metadata[poi.candidate] ?? [];
    popup.setHTML(`
      <a href="${satelliteUrl(poi.coordinates)}" target="_blank" class="underline">
        ${name || poi.layer.name}
      </a>
      ${openingHours ? `<br>Opening hours: ${openingHours}` : ''}
    `);
    popup.setLngLat(poi.coordinates);
    popup.addTo(map);
  };

  const onMouseMove = (event) => {
    if (map.isMoving()) {
      return;
    }

    map.getCanvasContainer().style.cursor = findPoi(event.point) ? 'pointer' : '';
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
