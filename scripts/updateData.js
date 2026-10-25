import { compress, encode } from '../common/codec.js';
import axios from 'axios';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import simplify from 'simplify-js';
import { fileURLToPath } from 'url';

config();

function relative(path) {
  return fileURLToPath(new URL(path, import.meta.url));
}

function write(path, data) {
  path = relative(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

async function query(queries, countries, out) {
  const interpreters = [
    `https://overpass.nextgis.com/${process.env.NEXTGIS_OVERPASS_API_KEY}/api/interpreter`,
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
      if (response.data.elements.length === 0) {
        throw 'No elements';
      }
      return response.data.elements;
    } catch (error) {
      if (i === interpreters.length - 1) {
        throw error;
      }
    }
  }
}

function encodePoi(elements) {
  const polyline = [];
  const metadata = [];
  for (const element of elements) {
    // prettier-ignore
    polyline.push([
      element.lat ?? element.center.lat,
      element.lon ?? element.center.lon
    ]);

    const name = element.tags.name ?? element.tags.brand ?? null;
    if (element.tags.opening_hours) {
      metadata.push([name, element.tags.opening_hours]);
    } else if (name) {
      metadata.push([name]);
    } else {
      metadata.push([]);
    }
  }
  return encode([polyline], metadata);
}

async function updatePoi(poi, queries) {
  const elements = await query(
    queries,
    ['AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'ES', 'FR', 'IT', 'LI', 'LU', 'MC', 'NL', 'PL', 'PT'],
    'out tags center qt;',
  );
  write(`../src/assets/data/${poi}.bin`, await compress(encodePoi(elements)));
}

function simplifyPolyline(polyline, toleranceMeters = 1) {
  if (polyline.length <= 2) {
    return polyline;
  }

  const lat = (polyline[0][0] * Math.PI) / 180;
  const degToMetersLat = 110574;
  const degToMetersLng = 111320 * Math.cos(lat);

  return simplify(
    polyline.map((coordinates, i) => ({
      x: coordinates[0] * degToMetersLat,
      y: coordinates[1] * degToMetersLng,
      i,
    })),
    toleranceMeters,
    true,
  ).map(({ i }) => polyline[i]);
}

function encodeWay(elements) {
  return encode(
    elements.map((element) => simplifyPolyline(element.geometry.map(({ lat, lon }) => [lat, lon]))),
  );
}

async function updateWay(way, queries) {
  const elements = await query(queries, ['DE'], 'out geom;');
  write(`../src/assets/data/${way}.bin`, await compress(encodeWay(elements)));
}

async function main() {
  const pois = {
    cafes: [
      'nwr["amenity"~"^(cafe|ice_cream)$"](area)',
      'nwr["shop"~"^(bakery|ice_cream|pastry)$"](area)',
    ],
    cemeteries: ['nwr["landuse"="cemetery"](area)', 'nwr["amenity"="grave_yard"](area)'],
    gasStations: ['nwr["amenity"="fuel"](area)'],
    supermarkets: ['nwr["shop"~"^(beverages|convenience|supermarket)$"](area)'],
    water: ['nwr["amenity"="drinking_water"](area)'],
  };
  for (const [poi, queries] of Object.entries(pois)) {
    console.time(poi);
    await updatePoi(poi, queries);
    console.timeEnd(poi);
  }

  const ways = {
    cobblestones: [
      'way["highway"]["surface"~"^(cobblestone|sett|cobblestone:flattened|unhewn_cobblestone)$"](area)',
    ],
  };
  for (const [way, queries] of Object.entries(ways)) {
    console.time(way);
    await updateWay(way, queries);
    console.timeEnd(way);
  }
}

main();
