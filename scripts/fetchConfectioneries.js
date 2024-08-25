import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

async function main() {
  const places = await queryOverpassApi(
    'nwr[shop~"^(bakery|beverages|coffee|confectionery|ice_cream|pastry)$"](area);',
  );
  writeJson(
    '../src/assets/geojson/confectioneries.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          name: place.tags.name || place.tags.brand || place.tags.operator || 'Confectionary',
        }),
      ),
    ),
  );
}

main();
