import axios from 'axios';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

function relative(path) {
  return fileURLToPath(new URL(path, import.meta.url));
}

function write(path, data) {
  path = relative(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function writeJson(path, data) {
  write(path, JSON.stringify(data));
}

async function overpass(queries) {
  // prettier-ignore
  const countries = ['AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'ES', 'FR', 'IT', 'LI', 'LU', 'MC', 'NL', 'PL', 'SL'];

  const response = await axios.post(
    'https://overpass-api.de/api/interpreter',
    [
      '[out:json][timeout:600];',
      // Combine area of countries
      '(',
      ...countries.map((country) => `area["ISO3166-1"="${country}"][admin_level=2];`),
      ');',
      // Run queries
      ...queries.map((query, index) => `${query} -> .q${index};`),
      // Combine queries
      '(',
      ...queries.map((_, index) => `.q${index};`),
      ');',
      // Add center to ways and relations, sort by quad tile for better compression
      'out center qt;',
    ].join('\n'),
  );

  const elements = response.data.elements.filter((element) => element.tags != null);
  for (const element of elements) {
    if (element.type === 'node') {
      element.center = {
        lat: element.lat,
        lon: element.lon,
      };
    }
  }
  return elements;
}

function encodeCoordinate(coordinate) {
  return Math.round(1e5 * coordinate);
}

function encodeCoordinateOffset(current, previous) {
  return encodeCoordinate(current) - encodeCoordinate(previous);
}

export async function update(path, queries) {
  const elements = await overpass(queries);
  writeJson(
    path,
    elements.map((element, index, array) => {
      const data = [
        encodeCoordinateOffset(element.center.lat, array[index - 1]?.center.lat ?? 0),
        encodeCoordinateOffset(element.center.lon, array[index - 1]?.center.lon ?? 0),
      ];
      const name = element.tags.name ?? element.tags.brand ?? element.tags.operator ?? '';
      if (element.tags.opening_hours) {
        data.push(name, element.tags.opening_hours);
      } else if (name) {
        data.push(name);
      }
      return data;
    }),
  );
}

async function main() {
  const pois = {
    cafes: ['nwr[amenity~"cafe|ice_cream"](area)', 'nwr[shop~"bakery|ice_cream|pastry"](area)'],
    cemeteries: ['nwr[landuse=cemetery](area)', 'nwr[amenity=grave_yard](area)'],
    gasStations: ['nwr[amenity=fuel](area)'],
    supermarkets: ['nwr[shop~"beverages|convenience|supermarket"](area)'],
  };

  const promises = [];
  for (const [poi, queries] of Object.entries(pois)) {
    promises.push(update(`../src/assets/data/${poi}.json`, queries));
  }
  await Promise.all(promises);
}

main();
