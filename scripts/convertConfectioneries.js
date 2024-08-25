import * as turf from '@turf/turf';
import _ from 'lodash';
import { readJson, writeJson } from './common.js';

function main() {
  const confectioneries = readJson('places.json')
    .filter((place) => ['bakery', 'cafe', 'ice_cream_shop'].includes(place.primaryType))
    .filter((confectionary) => {
      return true;
      for (const component of confectionary.addressComponents) {
        if (component.types.includes('country')) {
          return component.shortText === 'DE' || component.longText === 'Germany';
        }
      }
      return false;
    });

  writeJson(
    '../src/assets/geojson/confectioneries.geojson',
    turf.featureCollection(
      confectioneries.map((confectionary) => {
        return turf.point(
          [
            _.round(confectionary.location.longitude, 6),
            _.round(confectionary.location.latitude, 6),
          ],
          { name: confectionary.displayName.text },
        );
      }),
    ),
  );
}

main();
