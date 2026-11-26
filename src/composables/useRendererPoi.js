import { createProgram } from '@/utils/gl';
import { satelliteUrl } from '@/utils/googleMaps';
import { clamp, mapRange, roundTo } from '@/utils/numeric';
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

function getRadius(zoom) {
  return mapRange(zoom, 6, 18, 1, 16);
}

function createLayer(id, name, color, positions, metadata) {
  const vertexCount = positions.length / 2;
  const positionBuffer = new Float32Array(4 * vertexCount);
  const index = new Flatbush(vertexCount, 16, Float32Array);

  for (let i = 0; i < vertexCount; i++) {
    const coordinates = [positions[2 * i], positions[2 * i + 1]];
    const { x, y } = MercatorCoordinate.fromLngLat(coordinates);
    const highX = Math.fround(x);
    const highY = Math.fround(y);

    positionBuffer[4 * i] = highX;
    positionBuffer[4 * i + 1] = highY;
    positionBuffer[4 * i + 2] = x - highX;
    positionBuffer[4 * i + 3] = y - highY;
    index.add(coordinates[0], coordinates[1]);
  }
  index.finish();

  return {
    id,
    type: 'custom',
    renderingMode: '2d',

    name,
    index,
    positions,
    metadata,

    map: null,
    bounds: new LngLatBounds([index.minX, index.minY], [index.maxX, index.maxY]),
    program: null,
    buffer: null,
    vertexArray: null,
    attributes: null,
    uniforms: null,

    onAdd(map, gl) {
      this.map = map;
      this.program = createProgram(gl, vertexShader, fragmentShader);

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, positionBuffer, gl.STATIC_DRAW);

      this.vertexArray = gl.createVertexArray();
      gl.bindVertexArray(this.vertexArray);

      this.attributes = {
        positionHi: gl.getAttribLocation(this.program, 'a_positionHi'),
        positionLo: gl.getAttribLocation(this.program, 'a_positionLo'),
      };
      gl.enableVertexAttribArray(this.attributes.positionHi);
      gl.enableVertexAttribArray(this.attributes.positionLo);
      gl.vertexAttribPointer(this.attributes.positionHi, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(this.attributes.positionLo, 2, gl.FLOAT, false, 16, 8);
      gl.vertexAttribDivisor(this.attributes.positionHi, 0);
      gl.vertexAttribDivisor(this.attributes.positionLo, 0);

      this.uniforms = {
        matrix: gl.getUniformLocation(this.program, 'u_matrix'),
        originHi: gl.getUniformLocation(this.program, 'u_originHi'),
        originLo: gl.getUniformLocation(this.program, 'u_originLo'),
        originClip: gl.getUniformLocation(this.program, 'u_originClip'),
        pointSize: gl.getUniformLocation(this.program, 'u_pointSize'),
        color: gl.getUniformLocation(this.program, 'u_color'),
      };

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },

    render(gl, matrix) {
      if (!intersects(this.map.getBounds(), this.bounds)) {
        return;
      }

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vertexArray);
      gl.uniformMatrix4fv(this.uniforms.matrix, false, matrix);

      const { x, y } = MercatorCoordinate.fromLngLat(this.map.getCenter());
      const originHi = [Math.fround(x), Math.fround(y)];
      const originLo = [x - originHi[0], y - originHi[1]];
      const originClip = new Float32Array(4);
      for (let column = 0; column < 4; column++) {
        originClip[column] = matrix[column] * x + matrix[4 + column] * y + matrix[12 + column];
      }

      const radius = getRadius(this.map.getZoom());
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, gl.canvas.clientWidth);
      const [minPointSize, maxPointSize] = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      const pointSize = clamp(2 * radius * pixelRatio, minPointSize, maxPointSize);

      gl.uniform2f(this.uniforms.originHi, originHi[0], originHi[1]);
      gl.uniform2f(this.uniforms.originLo, originLo[0], originLo[1]);
      gl.uniform4fv(this.uniforms.originClip, originClip);
      gl.uniform1f(this.uniforms.pointSize, pointSize);
      gl.uniform4f(this.uniforms.color, color.r / 255, color.g / 255, color.b / 255, 1);
      gl.drawArrays(gl.POINTS, 0, vertexCount);
      gl.bindVertexArray(null);
    },

    onRemove(_, gl) {
      gl.deleteVertexArray(this.vertexArray);
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
    },
  };
}

export function useRendererPoi(map) {
  const layers = new Map();
  const popup = new Popup({ closeButton: false, closeOnClick: false });

  const findPoi = (point) => {
    const northEast = map.unproject([point.x - 32, point.y - 32]);
    const southWest = map.unproject([point.x + 32, point.y + 32]);

    let nearest = null;
    for (const layer of layers.values()) {
      for (const index of layer.index.search(
        northEast.lng,
        southWest.lat,
        southWest.lng,
        northEast.lat,
      )) {
        const coordinates = [layer.positions[2 * index], layer.positions[2 * index + 1]];
        const coordinatePoint = map.project(coordinates);
        const distance = Math.hypot(coordinatePoint.x - point.x, coordinatePoint.y - point.y);
        if (nearest == null || distance < nearest.distance) {
          nearest = { index, coordinates, distance, layer };
        }
      }
    }
    return nearest && nearest.distance <= getRadius(map.getZoom()) ? nearest : null;
  };

  const onClick = (event) => {
    const poi = findPoi(event.point);
    if (poi == null) {
      popup.remove();
      return;
    }

    const [name, openingHours] = poi.layer.metadata[poi.index] ?? [];
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
    map.getCanvas().classList.toggle('poi-hover', !map.isMoving() && findPoi(event.point));
  };

  map.on('click', onClick);
  map.on('mousemove', onMouseMove);

  const addLayer = ({ id, name, color, positions, metadata, beforeId }) => {
    removeLayer(id);

    const layer = createLayer(id, name, color, positions, metadata);
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
    map.getCanvas().classList.remove('poi-hover');
  };

  return { addLayer, removeLayer, dispose };
}
