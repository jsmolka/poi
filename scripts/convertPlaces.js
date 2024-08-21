import yargs from 'yargs/yargs';
import { readJson, writeJson } from './common.js';

function main(argv) {
  writeJson(
    argv.outputFile,
    readJson(argv.inputFile).map((place) => ({
      name: place.displayName.text,
      lat: place.location.latitude,
      lng: place.location.longitude,
    })),
  );
}

main(
  yargs(process.argv.slice(2))
    .option('inputFile', {
      type: 'string',
      requiresArg: true,
    })
    .option('outputFile', {
      type: 'string',
      requiresArg: true,
    })
    .parse(),
);
