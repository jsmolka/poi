import { compress, encode } from '../common/codec.js';
import axios, { AxiosError } from 'axios';
import { config } from 'dotenv';
import Flatbush from 'flatbush';
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

async function query(queries, country, out) {
  const overpasses = [
    'https://maps.mail.ru/osm/tools/overpass',
    'https://overpass.private.coffee',
    'https://overpass-api.de',
  ];

  if (nextgisOverpassApiKey) {
    overpasses.unshift(`https://overpass.nextgis.com/${nextgisOverpassApiKey}`);
  }

  for (const [i, overpass] of overpasses.entries()) {
    console.log('>', overpass.replaceAll(nextgisOverpassApiKey, 'API_KEY'));

    try {
      await axios.get(`${overpass}/api/kill_my_queries`);
    } catch {}

    try {
      const response = await axios.post(
        `${overpass}/api/interpreter`,
        [
          '[out:json][timeout:3600];',
          // Area
          `area["ISO3166-1"="${country.toUpperCase()}"][admin_level=2];`,
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

      const pipeline = chain([
        response.data,
        parser(),
        pick({ filter: /^(remark|elements\.\d+)$/ }),
        streamValues(),
      ]);

      const elements = [];
      try {
        for await (const { value } of pipeline) {
          if (typeof value !== 'object') {
            throw new Error(value);
          }
          elements.push(value);
        }
      } finally {
        pipeline.destroy();
        response.data.destroy();
      }

      if (elements.length === 0) {
        throw new Error('No elements');
      }
      return elements;
    } catch (error) {
      let message;
      if (axios.isAxiosError(error)) {
        try {
          let data = '';
          for await (const chunk of error.response.data) {
            data += chunk.toString('utf-8');
          }
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

      if (i === overpasses.length - 1) {
        throw new Error(message);
      }
    }
  }
}

function normalizePois(elements) {
  return elements.map((element) => [
    element.lon ?? element.center.lon,
    element.lat ?? element.center.lat,
    element.tags.name ?? element.tags.brand ?? null,
    element.tags.opening_hours ?? null,
  ]);
}

function sortPois(pois) {
  const bush = new Flatbush(pois.length);
  for (const [lng, lat] of pois) {
    bush.add(lng, lat);
  }
  bush.finish();

  const sorted = [];
  const sortedIndices = new Set();
  while (sorted.length < pois.length) {
    const [lng, lat] = sorted.at(-1) ?? [0, 0];
    const index = bush.neighbors(lng, lat, 1, Infinity, (index) => !sortedIndices.has(index))[0];

    sorted.push(pois[index]);
    sortedIndices.add(index);
  }
  return sorted;
}

function encodePois(elements) {
  const polyline = [];
  const metadata = [];
  for (const [lng, lat, name, openingHours] of sortPois(normalizePois(elements))) {
    polyline.push([lng, lat]);

    if (openingHours) {
      metadata.push([name, openingHours]);
    } else if (name) {
      metadata.push([name]);
    } else {
      metadata.push([]);
    }
  }
  return encode([polyline], metadata);
}

function normalizeWays(elements) {
  return elements.map((element) => element.geometry.map(({ lat, lon }) => [lon, lat]));
}

function sortWays(ways) {
  const bush = new Flatbush(ways.length);
  for (const [[lng, lat]] of ways) {
    bush.add(lng, lat);
  }
  bush.finish();

  const sorted = [];
  const sortedIndices = new Set();
  while (sorted.length < ways.length) {
    const [lng, lat] = sorted.at(-1)?.at(-1) ?? [0, 0];
    const index = bush.neighbors(lng, lat, 1, Infinity, (index) => !sortedIndices.has(index))[0];

    sorted.push(ways[index]);
    sortedIndices.add(index);
  }
  return sorted;
}

function encodeWays(elements) {
  return encode(
    sortWays(normalizeWays(elements)).map((way) => {
      let minLat = +Infinity;
      let maxLat = -Infinity;
      for (const [_, lat] of way) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }

      const lngToMeters = 111320 * Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
      const latToMeters = 110574;

      return simplify(
        way.map((coordinates) => ({
          x: coordinates[0] * lngToMeters,
          y: coordinates[1] * latToMeters,
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
        const elements = await query(queries, country, 'out tags center;');
        write(`../src/assets/data/${path}.bin`, await compress(encodePois(elements)));
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
        const elements = await query(queries, country, 'out skel geom;');
        write(`../src/assets/data/${path}.bin`, await compress(encodeWays(elements)));
      } finally {
        console.timeEnd(path);
        console.log();
      }
    }
  }
}

main();
