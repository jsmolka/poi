import csv from 'fast-csv';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { inspect as inspectUtil } from 'util';

export function inspect(object, depth = null) {
  return inspectUtil(object, false, depth, true);
}

function relative(...paths) {
  const cwd = dirname(fileURLToPath(import.meta.url));
  return resolve(cwd, ...paths);
}

export function read(path) {
  return readFileSync(relative(path));
}

export function readJson(path) {
  return JSON.parse(read(path));
}

export async function readCsv(path, options = { headers: true }) {
  const data = [];
  return new Promise((resolve) => {
    csv
      .parseFile(relative(path), options)
      .on('data', (item) => data.push(item))
      .on('end', () => resolve(data));
  });
}

export function write(path, data) {
  writeFileSync(relative(path), data);
}

export function writeJson(path, data) {
  write(path, JSON.stringify(data, undefined, 2));
}

export async function parallelize(threadCount, callback) {
  let terminated = false;

  const terminate = () => {
    terminated = true;
  };

  const isTerminated = () => {
    return terminated;
  };

  const threads = [];
  for (let thread = 0; thread < threadCount; thread++) {
    const job = async () => {
      return await callback({ thread, terminate, isTerminated });
    };
    threads.push(job());
  }
  return await Promise.all(threads);
}
