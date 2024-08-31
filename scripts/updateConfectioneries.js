import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

async function main() {
  const places = await queryOverpassApi(
    'nwr[amenity~"cafe|ice_cream"](area)',
    'nwr[shop~"bakery|ice_cream|pastry"](area)',
  );
  writeJson(
    '../src/assets/geojson/confectioneries.geojson',
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
