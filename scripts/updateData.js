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

async function overpass(queries) {
  // prettier-ignore
  const countries = ['AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'ES', 'FR', 'IT', 'LI', 'LU', 'MC', 'NL', 'PL', 'PT'];

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
      'out tags center qt;',
    ].join('\n'),
  );

  const elements = response.data.elements;
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

function toNullTerminated(string) {
  return string.replace(/\0/g, '') + '\0';
}

function encodePlace(place) {
  const encoder = new TextEncoder();
  const encodedName = encoder.encode(toNullTerminated(place.name));
  const encodedOpeningHours = encoder.encode(toNullTerminated(place.openingHours));

  const buffer = new Uint8Array(8 + encodedName.length + encodedOpeningHours.length);
  let offset = 0;

  const coordinates = Float32Array.of(place.lat, place.lng);
  buffer.set(new Uint8Array(coordinates.buffer), offset);
  offset += 8;

  buffer.set(encodedName, offset);
  offset += encodedName.length;

  buffer.set(encodedOpeningHours, offset);
  offset += encodedOpeningHours.length;

  return buffer;
}

function encodePlaces(places) {
  const encodedPlaces = places.map((place) => encodePlace(place));

  let length = 0;
  for (const encodedPlace of encodedPlaces) {
    length += encodedPlace.length;
  }

  const buffer = new Uint8Array(length);

  let offset = 0;
  for (const encodedPlace of encodedPlaces) {
    buffer.set(encodedPlace, offset);
    offset += encodedPlace.length;
  }
  return buffer;
}

export async function update(path, queries) {
  const elements = await overpass(queries);
  write(
    path,
    encodePlaces(
      elements.map((element) => ({
        lat: element.center.lat,
        lng: element.center.lon,
        name: element.tags.name ?? element.tags.brand ?? element.tags.operator ?? '',
        openingHours: element.tags.opening_hours ?? '',
      })),
    ),
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
    promises.push(update(`../src/assets/data/${poi}.bin`, queries));
  }
  await Promise.all(promises);
}

main();
