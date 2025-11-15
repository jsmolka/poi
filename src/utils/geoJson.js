import toGeoJSON from '@mapbox/togeojson';
import * as turf from '@turf/turf';

export function bufferToGeoJson(buffer) {
  const decoder = new TextDecoder('utf-8');

  const readFloat32 = (buffer, offset) => {
    // Prevent alignment issues during decoding
    const alignedBuffer = buffer.slice(offset, offset + 4);
    return new Float32Array(alignedBuffer.buffer)[0];
  };

  let offset = 0;
  const features = [];
  while (offset < buffer.length) {
    const lat = readFloat32(buffer, offset);
    offset += 4;

    const lng = readFloat32(buffer, offset);
    offset += 4;

    let start = offset;
    while (buffer[offset] !== 0) {
      offset++;
    }
    const name = decoder.decode(buffer.slice(start, offset));
    offset++; // Null terminator

    start = offset;
    while (buffer[offset] !== 0) {
      offset++;
    }
    const openingHours = decoder.decode(buffer.slice(start, offset));
    offset++; // Null terminator

    features.push(
      turf.point([lng, lat], {
        name,
        openingHours,
      }),
    );
  }
  return turf.featureCollection(features);
}

export function gpxToGeoJson(data) {
  return toGeoJSON.gpx(new DOMParser().parseFromString(data, 'text/xml'));
}
