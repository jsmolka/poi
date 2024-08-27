import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

async function main() {
  const places = await queryOverpassApi(
    'nwr[landuse=cemetery](area)',
    'nwr[amenity=grave_yard](area)',
  );
  writeJson(
    '../src/assets/geojson/cemeteries.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          name: place.tags.name,
          openingHours: place.tags.opening_hours,
        }),
      ),
    ),
  );
}

main();
