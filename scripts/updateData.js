import polyline from '@googlemaps/polyline-codec';
import axios from 'axios';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

config();

// https://wiki.openstreetmap.org/wiki/Precision_of_coordinates
const precision = 5;

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

async function query(queries, countries, out) {
  const interpreters = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  for (const [i, interpreter] of interpreters.entries()) {
    try {
      const response = await axios.post(
        interpreter,
        [
          '[out:json][timeout:3600];',
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
          out,
        ].join('\n'),
        {
          headers: {
            'User-Agent': 'poi',
          },
        },
      );
      if (response.data.remark != null) {
        throw response.data.remark;
      }
      return response.data.elements;
    } catch (error) {
      if (i === interpreters.length - 1) {
        throw error;
      }
    }
  }
}

function encodeCoordinate(coordinate) {
  return Math.round(10 ** precision * coordinate);
}

function encodeCoordinateOffset(current, previous) {
  return encodeCoordinate(current) - encodeCoordinate(previous);
}

function encodePoi(elements) {
  for (const element of elements) {
    if (element.type === 'node') {
      element.center = {
        lat: element.lat,
        lon: element.lon,
      };
    }
  }

  return elements.map((element, index, array) => {
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
  });
}

async function updatePoi(poi, queries) {
  const elements = await query(
    queries,
    ['AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'ES', 'FR', 'IT', 'LI', 'LU', 'MC', 'NL', 'PL', 'PT'],
    'out tags center qt;',
  );
  writeJson(`../src/assets/data/${poi}.json`, encodePoi(elements));
}

function encodeWay(elements) {
  return elements.map((element) => {
    const data = [
      polyline.encode(
        element.geometry.map(({ lat, lon }) => [lat, lon]),
        precision,
      ),
    ];

    // https://wiki.openstreetmap.org/wiki/Key:smoothness
    const smoothness = element.tags.smoothness;
    if (smoothness) {
      const index = [
        'excellent',
        'good',
        'intermediate',
        'bad',
        'very_bad',
        'horrible',
        'very_horrible',
        'impassable',
      ].indexOf(smoothness);
      if (index !== -1) {
        data.push(index);
      }
    }
    return data;
  });
}

async function updateWay(way, queries) {
  const elements = await query(queries, ['DE'], 'out tags geom;');
  writeJson(`../src/assets/data/${way}.json`, encodeWay(elements));
}

async function main() {
  const pois = {
    cafes: ['nwr[amenity~"cafe|ice_cream"](area)', 'nwr[shop~"bakery|ice_cream|pastry"](area)'],
    cemeteries: ['nwr[landuse=cemetery](area)', 'nwr[amenity=grave_yard](area)'],
    gasStations: ['nwr[amenity=fuel](area)'],
    supermarkets: ['nwr[shop~"beverages|convenience|supermarket"](area)'],
    water: ['nwr[amenity=drinking_water](area)'],
  };
  for (const [poi, queries] of Object.entries(pois)) {
    console.time(poi);
    await updatePoi(poi, queries);
    console.timeEnd(poi);
  }

  const ways = {
    cobblestones: [
      'way[highway][surface~"cobblestone|sett|cobblestone:flattened|unhewn_cobblestone"](area)',
    ],
  };
  for (const [way, queries] of Object.entries(ways)) {
    console.time(way);
    await updateWay(way, queries);
    console.timeEnd(way);
  }
}

main();
