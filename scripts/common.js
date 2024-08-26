import axios from 'axios';
import { writeFileSync } from 'fs';
import _ from 'lodash';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

function relative(...paths) {
  const cwd = dirname(fileURLToPath(import.meta.url));
  return resolve(cwd, ...paths);
}

export function write(path, data) {
  writeFileSync(relative(path), data);
}

export function writeJson(path, data) {
  write(path, JSON.stringify(data, undefined, 2));
}

export async function queryOverpassApi(...queries) {
  const response = await axios.post(
    'https://overpass-api.de/api/interpreter',
    `
      [out:json][timeout:600];
      area["ISO3166-1"="DE"][admin_level=2];
      ${queries.map((query, index) => `${query} -> .q${index};`).join('')}
      (${queries.map((_, index) => `.q${index};`).join('')});
      out center;
    `,
  );
  return response.data.elements
    .filter((element) => ['node', 'way', 'relation'].includes(element.type))
    .filter((element) => element.tags != null)
    .map((element) => {
      if (element.type === 'node') {
        element.center = {
          lat: element.lat,
          lon: element.lon,
        };
      }
      element.center.lat = _.round(element.center.lat, 6);
      element.center.lon = _.round(element.center.lon, 6);
      return element;
    })
    .sort((a, b) => a.id - b.id);
}
