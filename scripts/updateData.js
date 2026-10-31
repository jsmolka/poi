import { compress, encode } from '../common/codec.js';
import axios, { AxiosError } from 'axios';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import simplify from 'simplify-js';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick.js';
import { streamValues } from 'stream-json/streamers/stream-values.js';
import { fileURLToPath } from 'url';

config();

const nextgisOverpassApiKey = process.env.NEXTGIS_OVERPASS_API_KEY;

function write(path, data) {
  writeFileSync(fileURLToPath(new URL(path, import.meta.url)), data);
}

async function query(queries, countries, out) {
  let interpreters = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  if (nextgisOverpassApiKey) {
    interpreters = [
      `https://overpass.nextgis.com/${nextgisOverpassApiKey}/api/interpreter`,
      ...interpreters,
    ];
  }

  for (const [i, interpreter] of interpreters.entries()) {
    console.log(
      '>',
      nextgisOverpassApiKey
        ? interpreter.replaceAll(nextgisOverpassApiKey, 'API_KEY')
        : interpreter,
    );

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
        throw new AxiosError(undefined, undefined, undefined, undefined, response);
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
      let message;
      if (axios.isAxiosError(error)) {
        let data = '';
        for await (const chunk of error.response.data) {
          data += chunk.toString('utf-8');
        }

        try {
          message = data.match(/Error<\/strong>:\s*([^<]+)/)[1].trim();
        } catch {
          message = error.message;
        }
      } else if (error instanceof Error) {
        message = error.message;
      } else {
        message = error;
      }

      console.log('x', message);

      if (i === interpreters.length - 1) {
        throw new Error(message);
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
      const degToMetersLat = 110574;
      const degToMetersLng = 111320 * Math.cos(polyline[0][0] * (Math.PI / 180));

      return simplify(
        polyline.map((coordinates) => ({
          x: coordinates[0] * degToMetersLat,
          y: coordinates[1] * degToMetersLng,
          coordinates,
        })),
        0.5,
        true,
      ).map(({ coordinates }) => coordinates);
    }),
    [],
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
      console.log(path);
      console.time(path);
      try {
        const elements = await query(queries, [country], 'out tags center qt;');
        write(`../src/assets/data/${path}.bin`, await compress(encodePoi(elements)));
      } finally {
        console.timeEnd(path);
        console.log();
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
      console.log(path);
      console.time(path);
      try {
        const elements = await query(queries, [country], 'out geom;');
        write(`../src/assets/data/${path}.bin`, await compress(encodeWay(elements)));
      } finally {
        console.timeEnd(path);
        console.log();
      }
    }
  }
}

main();
