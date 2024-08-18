import csv from 'fast-csv';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Station brands by count
// https://de.wikipedia.org/wiki/Tankstelle#Anzahl_von_Tankstellen_in_Deutschland
const brands = [
  'BFT',
  'Aral',
  'Shell',
  'Total',
  'ELAN',
  'Esso',
  'Avia',
  'Jet',
  'Raiffeisen',
  'Star',
  'Orlen',
  'Agip',
  'Eni',
  'Tamoil',
  'HEM',
  'OMV',
  'Westfalen',
  'Hoyer',
  'Oil!',
  'Q1',
  'Classic',
  'Nordoel',
  'team',
  'Calpam',
  'Sprint',
  'Score',
  'Bavaria',
  'Allguth',
  'Pinoil',
  'Mundorf',
  'SVG',
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
    const value = (item.brand || item.name).toLowerCase();
    for (const brand of brands) {
      if (value.includes(brand.toLowerCase())) {
        item.brand = brand;
        break;
      }
    }
  }

  writeFileSync(
    relative('../src/data/stations.json'),
    JSON.stringify(
      data
        .filter((item) => brands.some((brand) => item.brand === brand))
        .map((item) => ({
          brand: item.brand,
          lat: item.lat,
          lng: item.lng,
        })),
      null,
      2,
    ),
  );
}

main();
