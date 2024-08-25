import * as turf from '@turf/turf';
import _ from 'lodash';
import { readJson, writeJson } from './common.js';

function main() {
  const supermarkets = readJson('places.json')
    .filter((place) => ['grocery_store', 'supermarket'].includes(place.primaryType))
    .filter((supermarket) => {
      return true;
      for (const component of supermarket.addressComponents) {
        if (component.types.includes('country')) {
          return component.shortText === 'DE' || component.longText === 'Germany';
        }
      }
      return false;
    });

  writeJson(
    '../src/assets/geojson/supermarkets.geojson',
    turf.featureCollection(
      supermarkets.map((supermarket) => {
        return turf.point(
          [_.round(supermarket.location.longitude, 6), _.round(supermarket.location.latitude, 6)],
          { name: supermarket.displayName.text },
        );
      }),
    ),
  );
}

main();
