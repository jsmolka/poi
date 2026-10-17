import { decode } from '@googlemaps/polyline-codec';
import toGeoJSON from '@mapbox/togeojson';
import * as turf from '@turf/turf';

const precision = 5;

export function poiToGeoJson(data) {
  const meta = [];
  for (let item of data.meta) {
    switch (typeof item) {
      case 'object':
        meta.push(item);
        break;
      case 'string':
        meta.push([item]);
        break;
      case 'number':
        while (item--) {
          meta.push([]);
        }
        break;
    }
  }

  return turf.featureCollection(
    decode(data.data, precision).map(([lat, lng], index) => {
      const [name, openingHours] = meta[index];
      return turf.point([lng, lat], {
        name,
        openingHours,
      });
    }),
  );
}

export function wayToGeoJson(data) {
  return turf.featureCollection(
    data.map((coordinates) =>
      turf.lineString(decode(coordinates, precision).map(([lat, lng]) => [lng, lat])),
    ),
  );
}

export function gpxToGeoJson(data) {
  return toGeoJSON.gpx(new DOMParser().parseFromString(data, 'text/xml'));
}
