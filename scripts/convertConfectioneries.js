import * as turf from '@turf/turf';
import _ from 'lodash';
import { isGermanPlace, readJson, writeJson } from './common.js';

function main() {
  const places = readJson('places.json')
    .filter((place) => ['bakery', 'cafe', 'ice_cream_shop'].includes(place.primaryType))
    .filter((place) => isGermanPlace(place));

  writeJson(
    '../src/assets/geojson/confectioneries.geojson',
    turf.featureCollection(
      places.map((place) => {
        return turf.point(
          [place.location.longitude, place.location.latitude].map((coordinate) =>
            _.round(coordinate, 6),
          ),
          { name: place.displayName.text },
        );
      }),
    ),
  );
}

main();
