import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

async function main() {
  const places = await queryOverpassApi('nwr[amenity=drinking_water](area);');
  writeJson(
    '../src/assets/geojson/drinkingWater.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          id: place.id,
          name: place.tags.name,
          openingHours: place.tags.opening_hours,
        }),
      ),
    ),
  );
}

main();
