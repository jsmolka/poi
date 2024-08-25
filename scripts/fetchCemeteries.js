import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

const testedIds = [
  2837558, // Ramsdorf
  180118850, // Kleingörschen
];

async function main() {
  const places = await queryOverpassApi('nwr[landuse~"cemetery|grave_yard"](area)');
  writeJson(
    '../src/assets/geojson/cemeteries.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          id: place.id,
          name: place.tags.name,
          openingHours: place.tags.opening_hours,
          tested: testedIds.includes(place.id) ? true : undefined,
        }),
      ),
    ),
  );
}

main();
