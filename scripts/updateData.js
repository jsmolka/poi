import axios from 'axios';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

function relative(path) {
  return fileURLToPath(new URL(path, import.meta.url));
}

function write(path, data) {
  const file = relative(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

function writeJson(path, data) {
  write(path, JSON.stringify(data));
}

async function overpass(countries, queries) {
  const response = await axios.post(
    'https://overpass-api.de/api/interpreter',
    `
      [out:json][timeout:600];
      (${countries.map((country) => `area["ISO3166-1"="${country}"][admin_level=2];`).join('')});
      ${queries.map((query, index) => `${query} -> .q${index};`).join('')}
      (${queries.map((_, index) => `.q${index};`).join('')});
      out center qt;
    `,
  );

  return response.data.elements
    .filter((element) => element.tags != null)
    .map((element) => {
      if (element.type === 'node') {
        element.center = {
          lat: element.lat,
          lon: element.lon,
        };
      }
      return element;
    });
}

function encodeCoordinate(coordinate) {
  return Math.round(coordinate * 1e5);
}

function encodeCoordinateOffset(current, previous) {
  return encodeCoordinate(current) - encodeCoordinate(previous);
}

export async function update(path, countries, queries) {
  const places = await overpass(countries, queries);
  writeJson(
    path,
    places.map((place, index, array) => {
      const data = [
        encodeCoordinateOffset(place.center.lat, array[index - 1]?.center.lat ?? 0),
        encodeCoordinateOffset(place.center.lon, array[index - 1]?.center.lon ?? 0),
        place.tags.name ?? place.tags.brand ?? place.tags.operator ?? '',
      ];
      if (place.tags.opening_hours) {
        data.push(place.tags.opening_hours);
      }
      return data;
    }),
  );
}

const countries = ['DE', 'PL', 'CZ', 'AT', 'IT', 'CH', 'FR', 'ES', 'BE', 'NL', 'LU'];
const pois = {
  cafes: ['nwr[amenity~"cafe|ice_cream"](area)', 'nwr[shop~"bakery|ice_cream|pastry"](area)'],
  cemeteries: ['nwr[landuse=cemetery](area)', 'nwr[amenity=grave_yard](area)'],
  gasStations: ['nwr[amenity=fuel](area)'],
  supermarkets: ['nwr[shop~"beverages|convenience|supermarket"](area)'],
};

async function main() {
  for (const [poi, queries] of Object.entries(pois)) {
    await update(`../src/assets/data/eu/${poi}.json`, countries, queries);
  }
}

main();
