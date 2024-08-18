import csv from 'fast-csv';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const brands = [
  'Access',
  'Agip',
  'Albers',
  'Allguth',
  'Aral',
  'Avex',
  'Avia',
  'Bavaria',
  'Bell',
  'Bergler',
  'BFT',
  'Calpam',
  'Classic',
  'ED',
  'ELAN',
  'Elo',
  'Eni',
  'Esso',
  'Familia',
  'Felta',
  'Globus',
  'GO',
  'Gulf',
  'HEM',
  'HERM',
  'Hessol',
  'Honsel',
  'Hoyer',
  'Jet',
  'Joiss',
  'LTG',
  'Markant',
  'Mundorf',
  'Nordoel',
  'Oil!',
  'OMV',
  'Orlen',
  'Pinoil',
  'Pludra',
  'PM',
  'Q1',
  'Raiffeisen',
  'RAN',
  'Rolfes',
  'SB',
  'Score',
  'Shell',
  'Sprint',
  'Star',
  'Supol',
  'SVG',
  'Tamoil',
  'Tankpoint',
  'TAS',
  'team',
  'Total',
  'TS',
  'Westfalen',
];

async function readCsv(file, options = { headers: true }) {
  const data = [];
  return new Promise((resolve) => {
    csv
      .parseFile(file, options)
      .on('data', (item) => {
        item.lat = parseFloat(item.lat);
        item.lng = parseFloat(item.lng);
        if (item.lat !== 0 && item.lng !== 0) {
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

    brandsLoop: for (const brand of brands) {
      for (const word of words) {
        if (word === brand.toLowerCase()) {
          item.brand = brand;
          break brandsLoop;
        }
      }
    }
  }

  writeFileSync(
    relative('../src/data/stations.json'),
    JSON.stringify(
      data
        .filter((item) => brands.some((brand) => item.brand === brand))
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
