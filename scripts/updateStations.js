import csv from 'fast-csv';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const brands = [
  { key: 'access', value: 'Access' },
  { key: 'agip', value: 'Agip' },
  { key: 'albers', value: 'Albers' },
  { key: 'allguth', value: 'Allguth' },
  { key: 'aral', value: 'Aral' },
  { key: 'avex', value: 'Avex' },
  { key: 'avia', value: 'Avia' },
  { key: 'bavaria', value: 'Bavaria' },
  { key: 'bell', value: 'Bell' },
  { key: 'bergler', value: 'Bergler' },
  { key: 'bft', value: 'BFT' },
  { key: 'bk', value: 'BK' },
  { key: 'bremer', value: 'BMÖ' },
  { key: 'calpam', value: 'Calpam' },
  { key: 'classic', value: 'Classic' },
  { key: 'cleancar', value: 'CleanCar' },
  { key: 'ed', value: 'ED' },
  { key: 'elan', value: 'ELAN' },
  { key: 'elo', value: 'Elo' },
  { key: 'eni', value: 'Eni' },
  { key: 'esso', value: 'Esso' },
  { key: 'familia', value: 'Familia' },
  { key: 'felta', value: 'Felta' },
  { key: 'globus', value: 'Globus' },
  { key: 'go', value: 'GO' },
  { key: 'greenline', value: 'Greenline' },
  { key: 'gulf', value: 'Gulf' },
  { key: 'hem', value: 'HEM' },
  { key: 'herm', value: 'HERM' },
  { key: 'hessol', value: 'Hessol' },
  { key: 'honsel', value: 'Honsel' },
  { key: 'hoyer', value: 'Hoyer' },
  { key: 'jet', value: 'Jet' },
  { key: 'jantzon', value: 'Jantzon' },
  { key: 'joiss', value: 'Joiss' },
  { key: 'jtg', value: 'LTG' },
  { key: 'kaiser', value: 'Kaiser' },
  { key: 'm1', value: 'M1' },
  { key: 'markant', value: 'Markant' },
  { key: 'mundorf', value: 'Mundorf' },
  { key: 'nordoel', value: 'Nordoel' },
  { key: 'oil!', value: 'Oil!' },
  { key: 'omv', value: 'OMV' },
  { key: 'orlen', value: 'Orlen' },
  { key: 'pin', value: 'PIN' },
  { key: 'pinoil', value: 'PIN' },
  { key: 'pludra', value: 'Pludra' },
  { key: 'pm', value: 'PM' },
  { key: 'q1', value: 'Q1' },
  { key: 'raiffeisen', value: 'Raiffeisen' },
  { key: 'ran', value: 'RAN' },
  { key: 'rolfes', value: 'Rolfes' },
  { key: 'roth', value: 'ROTH' },
  { key: 'sb', value: 'SB' },
  { key: 'score', value: 'Score' },
  { key: 'shell', value: 'Shell' },
  { key: 'sprint', value: 'Sprint' },
  { key: 'star', value: 'star' },
  { key: 'supol', value: 'Supol' },
  { key: 'svg', value: 'SVG' },
  { key: 'tamoil', value: 'Tamoil' },
  { key: 'tankpoint', value: 'Tankpoint' },
  { key: 'tap', value: 'TAP' },
  { key: 'tas', value: 'TAS' },
  { key: 'team', value: 'team' },
  { key: 'tinq', value: 'TinQ' },
  { key: 'total', value: 'TotalEnergies' },
  { key: 'totalenergies', value: 'TotalEnergies' },
  { key: 'ts', value: 'TS' },
  { key: 'walther', value: 'BFT' },
  { key: 'westfalen', value: 'Westfalen' },
  { key: 'willer', value: 'BFT' },
  { key: 'wiro', value: 'Wiro' },
];

// Relaxed bounding box
// https://en.wikipedia.org/wiki/Geography_of_Germany#Area
const germany = {
  lat: {
    min: 46,
    max: 56,
  },
  lng: {
    min: 4,
    max: 17,
  },
};

async function readCsv(file, options = { headers: true }) {
  const data = [];
  return new Promise((resolve) => {
    csv
      .parseFile(file, options)
      .on('data', (item) => {
        item.lat = parseFloat(item.lat);
        item.lng = parseFloat(item.lng);
        if (
          item.lat >= germany.lat.min &&
          item.lat <= germany.lat.max &&
          item.lng >= germany.lng.min &&
          item.lng <= germany.lng.max
        ) {
          data.push(item);
        }
      })
      .on('end', () => {
        resolve(data);
      });
  });
}

function relative(...paths) {
  const cwd = dirname(fileURLToPath(import.meta.url));
  return resolve(cwd, ...paths);
}

async function main() {
  const data = await readCsv(relative('stations.csv'), {
    headers: (headers) =>
      headers.map((header) => {
        switch (header) {
          case 'latitude':
            return 'lat';
          case 'longitude':
            return 'lng';
          default:
            return header;
        }
      }),
  });

  // Normalize brand names
  for (const item of data) {
    const words = (item.brand || item.name)
      .toLowerCase()
      .replace(/(\(|\))/g, '')
      .split(/(\s|-)/g);

    brandsLoop: for (const { key, value } of brands) {
      for (const word of words) {
        if (word === key) {
          item.brand = value;
          break brandsLoop;
        }
      }
    }
  }

  writeFileSync(
    relative('../src/data/stations.json'),
    JSON.stringify(
      data
        .filter((item) => brands.some(({ value }) => item.brand === value))
        .map((item) => ({
          name: item.brand,
          lat: item.lat,
          lng: item.lng,
        })),
      null,
      2,
    ),
  );
}

main();
