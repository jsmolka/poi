import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

const tested = [
  180118850, // Kleingörschen
  2837558, // Ramsdorf
];

async function main() {
  const places = await queryOverpassApi('nwr[landuse=cemetery](area);');
  writeJson(
    '../src/assets/geojson/cemeteries.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          id: place.id,
          name: place.tags.name,
          openingHours: place.tags.opening_hours,
          tested: tested.includes(place.id) ? true : undefined,
        }),
      ),
    ),
  );
}

main();
