import { decode, decompress } from '@common/codec';
import toGeoJSON from '@mapbox/togeojson';
import * as turf from '@turf/turf';

export async function poiToGeoJson(data) {
  const { polylines, metadata } = decode(await decompress(data));

  return turf.featureCollection(
    polylines[0].map(([lat, lng], index) => {
      const [name, openingHours] = metadata[index];
      return turf.point([lng, lat], {
        name,
        openingHours,
      });
    }),
  );
}

export async function wayToGeoJson(data) {
  const { polylines } = decode(await decompress(data));

  return turf.featureCollection(
    polylines.map((coordinates) => turf.lineString(coordinates.map(([lat, lng]) => [lng, lat]))),
  );
}

export function gpxToGeoJson(data) {
  return toGeoJSON.gpx(new DOMParser().parseFromString(data, 'text/xml'));
}
