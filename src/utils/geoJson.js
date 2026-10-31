import toGeoJSON from '@mapbox/togeojson';

export function gpxToGeoJson(data) {
  return toGeoJSON.gpx(new DOMParser().parseFromString(data, 'text/xml'));
}
