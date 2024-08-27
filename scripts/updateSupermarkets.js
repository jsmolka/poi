import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

async function main() {
  const places = await queryOverpassApi(
    'nwr[shop~"beverages|convenience|supermarket|water"](area)',
  );
  writeJson(
    '../src/assets/geojson/supermarkets.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          name: place.tags.name ?? place.tags.brand ?? place.tags.operator,
          openingHours: place.tags.opening_hours,
        }),
      ),
    ),
  );
}

main();
