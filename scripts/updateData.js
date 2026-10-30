import { compress, encode } from '../common/codec.js';
import axios from 'axios';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import simplify from 'simplify-js';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick.js';
import { streamValues } from 'stream-json/streamers/stream-values.js';
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
          ...countries.map(
            (country) => `area["ISO3166-1"="${country.toUpperCase()}"][admin_level=2];`,
          ),
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
          // Some responses exceed Node's string length limit
          responseType: 'stream',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'poi',
          },
        },
      );

      if (response.headers['content-type'] !== 'application/json') {
        let data = '';
        for await (const chunk of response.data) {
          data += chunk.toString('utf-8');
        }

        let error;
        try {
          error = data.match(/Error<\/strong>:\s*([^<]+)/)[1].trim();
        } catch {
          error = data;
        }
        throw error;
      }

      return new Promise((resolve, reject) => {
        const pipeline = chain([
          response.data,
          parser(),
          pick({ filter: /^(remark|elements\.\d+)$/ }),
          streamValues(),
        ]);

        const elements = [];

        pipeline.on('data', ({ value }) => {
          if (typeof value === 'object') {
            elements.push(value);
          } else {
            response.data.destroy();
            pipeline.destroy();
            reject(value);
          }
        });

        pipeline.on('end', () => {
          if (elements.length > 0) {
            resolve(elements);
          } else {
            reject('No elements');
          }
        });

        pipeline.on('error', reject);
      });
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

function encodeWay(elements) {
  return encode(
    elements.map((element) => {
      const polyline = element.geometry.map(({ lat, lon }) => [lat, lon]);
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
        1,
        true,
      ).map(({ i }) => polyline[i]);
    }),
  );
}

async function main() {
  // prettier-ignore
  const countries = ['at', 'be', 'ch', 'cz', 'de', 'dk', 'es', 'fr', 'it', 'li', 'lu', 'mc', 'nl', 'pl', 'pt', 'si'];

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
    for (const country of countries) {
      const path = `${poi}/${country}`;
      console.time(path);
      try {
        const elements = await query(queries, [country], 'out tags center qt;');
        write(`../src/assets/data/${path}.bin`, await compress(encodePoi(elements)));
      } finally {
        console.timeEnd(path);
      }
    }
  }

  const ways = {
    cobblestones: [
      'way["highway"]["surface"~"^(cobblestone|sett|cobblestone:flattened|unhewn_cobblestone)$"](area)',
    ],
    gravel: ['way["highway"]["surface"~"^(gravel|fine_gravel|compacted|pebblestone)$"](area)'],
  };
  for (const [way, queries] of Object.entries(ways)) {
    for (const country of countries) {
      const path = `${way}/${country}`;
      console.time(path);
      try {
        const elements = await query(queries, [country], 'out geom;');
        write(`../src/assets/data/${path}.bin`, await compress(encodeWay(elements)));
      } finally {
        console.timeEnd(path);
      }
    }
  }
}

main();
