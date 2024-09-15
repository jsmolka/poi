import * as turf from '@turf/turf';

export function dataToGeoJson(data) {
  let lat = 0;
  let lng = 0;
  return turf.featureCollection(
    data.map((item) => {
      lat += item[0];
      lng += item[1];
      const point = turf.point([lng * 1e-5, lat * 1e-5], {
        name: item[2] || undefined,
        openingHours: item[3] || undefined,
      });
      return point;
    }),
  );
}
