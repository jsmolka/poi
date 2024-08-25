import * as turf from '@turf/turf';
import { queryOverpassApi, writeJson } from './common.js';

async function main() {
  const places = await queryOverpassApi('nwr[amenity=fuel](area);');
  writeJson(
    '../src/assets/geojson/gasStations.geojson',
    turf.featureCollection(
      places.map((place) =>
        turf.point([place.center.lon, place.center.lat], {
          name: place.tags.name || place.tags.brand || place.tags.operation || 'Gas station',
        }),
      ),
    ),
  );
}

main();
