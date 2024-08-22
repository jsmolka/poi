import * as turf from '@turf/turf';
import _ from 'lodash';
import { readJson, writeJson } from './common.js';

function main() {
  writeJson(
    '../src/assets/geojson/cemeteries.geojson',
    turf.featureCollection(
      readJson('cemeteries.json').map((place) =>
        turf.point([_.round(place.location.longitude, 6), _.round(place.location.latitude, 6)], {
          name: place.displayName.text,
        }),
      ),
    ),
  );
}

main();
