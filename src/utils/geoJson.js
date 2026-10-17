import { decode } from '@googlemaps/polyline-codec';
import toGeoJSON from '@mapbox/togeojson';
import * as turf from '@turf/turf';

export function poiToGeoJson(data) {
  let lat = 0;
  let lng = 0;
  return turf.featureCollection(
    data.map((item) => {
      lat += item[0];
      lng += item[1];
      return turf.point([1e-5 * lng, 1e-5 * lat], {
        name: item[2],
        openingHours: item[3],
      });
    }),
  );
}

export function wayToGeoJson(data) {
  return turf.featureCollection(
    data.map(([coordinates, smoothness]) =>
      turf.lineString(
        decode(coordinates).map(([lat, lng]) => [lng, lat]),
        {
          smoothness: [
            'excellent',
            'good',
            'intermediate',
            'bad',
            'very bad',
            'horrible',
            'very horrible',
            'impassable',
          ].map(
            (smoothness, index, array) => `${smoothness} (${array.length - index}/${array.length})`,
          )[smoothness],
        },
      ),
    ),
  );
}

export function gpxToGeoJson(data) {
  return toGeoJSON.gpx(new DOMParser().parseFromString(data, 'text/xml'));
}
