import csv from 'fast-csv';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

async function read(file) {
  const rows = [];
  return new Promise((resolve) => {
    csv
      .parseFile(file, { headers: true })
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        resolve(rows);
      });
  });
}

async function main() {
  const cwd = dirname(fileURLToPath(import.meta.url));
  const rows = await read(resolve(cwd, 'stations.csv'));
  writeFileSync(
    resolve(cwd, '../src/data/stations.json'),
    JSON.stringify(rows.map((row) => ({ lng: row.longitude, lat: row.latitude }))),
  );
}

main();
