import * as turf from '@turf/turf';
import * as geokdbush from 'geokdbush';
import KDBush from 'kdbush';
import _ from 'lodash';
import { readJson, writeJson } from './common.js';

function groupNearbyPlaces(places, distanceKm) {
  const index = new KDBush(places.length);
  for (const place of places) {
    index.add(place.location.longitude, place.location.latitude);
  }
  index.finish();

  const processed = new Set();

  const collectNearbyPlaces = (place) => {
    processed.add(place.id);
    const nearbyPlaces = [place];
    for (const nearbyPlaceIndex of geokdbush.around(
      index,
      place.location.longitude,
      place.location.latitude,
      Infinity,
      distanceKm,
    )) {
      const nearbyPlace = places[nearbyPlaceIndex];
      if (!processed.has(nearbyPlace.id)) {
        nearbyPlaces.push(...collectNearbyPlaces(nearbyPlace));
      }
    }
    return nearbyPlaces;
  };

  const groups = [];
  for (const place of places) {
    if (!processed.has(place.id)) {
      groups.push(collectNearbyPlaces(place));
    }
  }
  return groups;
}

function main() {
  const cemeteries = readJson('cemeteries.json').filter((cemetery) => {
    for (const component of cemetery.addressComponents) {
      if (component.types.includes('country')) {
        return component.shortText === 'DE' || component.longText === 'Germany';
      }
    }
    return false;
  });

  const groups = groupNearbyPlaces(cemeteries, 0.5);
  for (const group of groups) {
    group.sort((a, b) => {
      const rank = (text) => {
        text = text.toLowerCase();
        const words = text.split(' ');
        const translations = ['friedhof', 'cemetery'];
        for (const [index, translation] of translations.entries()) {
          const factor = translations.length - index;
          if (words.includes(translation)) {
            return 3 * factor;
          } else if (words.some((word) => word.endsWith(translation))) {
            return 2 * factor;
          } else if (text.includes(translation)) {
            return 1 * factor;
          }
        }
        return 0;
      };

      const rankA = rank(a.displayName.text);
      const rankB = rank(b.displayName.text);
      if (rankA === rankB && rankA !== 0) {
        return a.displayName.text.length - b.displayName.text.length;
      } else {
        return rankB - rankA;
      }
    });
  }

  writeJson(
    '../src/assets/geojson/cemeteries.geojson',
    turf.featureCollection(
      groups.map((group) => {
        const center = turf.centroid(
          turf.featureCollection(
            group.map((cemetery) =>
              turf.point([cemetery.location.longitude, cemetery.location.latitude]),
            ),
          ),
        );
        return turf.point(
          center.geometry.coordinates.map((coordinate) => _.round(coordinate, 6)),
          { name: group[0].displayName.text },
        );
      }),
    ),
  );
}

main();
