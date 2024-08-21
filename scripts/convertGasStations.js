import { readCsv, writeJson } from './common.js';

const brands = [
  { key: 'access', value: 'Access' },
  { key: 'agip', value: 'Agip' },
  { key: 'ahr', value: 'AHR' },
  { key: 'albers', value: 'Albers' },
  { key: 'allguth', value: 'Allguth' },
  { key: 'aral', value: 'Aral' },
  { key: 'avex', value: 'AVEX' },
  { key: 'avia', value: 'Avia' },
  { key: 'bavaria', value: 'BAVARIA petrol' },
  { key: 'bell', value: 'BELL Oil' },
  { key: 'bergler', value: 'Bergler' },
  { key: 'bft-freie', value: 'BFT' },
  { key: 'bft-station', value: 'BFT' },
  { key: 'bft-tankstelle', value: 'BFT' },
  { key: 'bft-walther', value: 'BFT' },
  { key: 'bft-willer', value: 'BFT' },
  { key: 'bft', value: 'BFT' },
  { key: 'bk-tankstelle', value: 'BK' },
  { key: 'bk', value: 'BK' },
  { key: 'bremer', value: 'BMÖ' },
  { key: 'calpam', value: 'Calpam' },
  { key: 'classic', value: 'CLASSIC' },
  { key: 'cleancar', value: 'CleanCar' },
  { key: 'deltin', value: 'DELTIN' },
  { key: 'ed', value: 'ED' },
  { key: 'elan', value: 'ELAN' },
  { key: 'elo', value: 'ELO' },
  { key: 'eni', value: 'Agip' },
  { key: 'ept', value: 'EPT' },
  { key: 'esso', value: 'ESSO' },
  { key: 'famila', value: 'FAMILA' },
  { key: 'felta', value: 'FELTA' },
  { key: 'globus', value: 'GLOBUS' },
  { key: 'go', value: 'GO' },
  { key: 'greenline', value: 'Greenline' },
  { key: 'gs', value: 'GS' },
  { key: 'gulf', value: 'Gulf' },
  { key: 'hem', value: 'HEM' },
  { key: 'herm', value: 'HERM' },
  { key: 'hessol', value: 'Hessol' },
  { key: 'honsel', value: 'Honsel' },
  { key: 'hoyer', value: 'Hoyer' },
  { key: 'jantzon', value: 'Jantzon' },
  { key: 'jet', value: 'JET' },
  { key: 'joiss', value: 'Joiss' },
  { key: 'kuster', value: 'Kuster Energy' },
  { key: 'lenz', value: 'Lenz' },
  { key: 'leo', value: 'LEO' },
  { key: 'm1', value: 'M1' },
  { key: 'markant', value: 'Markant' },
  { key: 'mundorf', value: 'Mundorf' },
  { key: 'nordoel', value: 'NORDOEL' },
  { key: 'oil!', value: 'OIL!' },
  { key: 'omv', value: 'OMV' },
  { key: 'orlen', value: 'ORLEN' },
  { key: 'pin', value: 'PIN' },
  { key: 'pinoil', value: 'PIN' },
  { key: 'pludra', value: 'Pludra' },
  { key: 'pm', value: 'PM' },
  { key: 'q1', value: 'Q1' },
  { key: 'raiffeisen', value: 'Raiffeisen' },
  { key: 'ran', value: 'RAN' },
  { key: 'rolfes', value: 'Rolfes' },
  { key: 'sb-markttankstelle', value: 'SB' },
  { key: 'sb', value: 'SB' },
  { key: 'score', value: 'SCORE' },
  { key: 'shell', value: 'Shell' },
  { key: 'sprint', value: 'Sprint' },
  { key: 'star', value: 'star' },
  { key: 'sunoil', value: 'Sunoil' },
  { key: 'supol', value: 'SUPOL' },
  { key: 'svg-nordrhein', value: 'SVG' },
  { key: 'svg', value: 'SVG' },
  { key: 'tamoil', value: 'TAMOIL' },
  { key: 'tankpoint', value: 'tankpoint' },
  { key: 'tap', value: 'TAP' },
  { key: 'tas', value: 'TAS' },
  { key: 'team', value: 'team' },
  { key: 'tinq', value: 'TinQ' },
  { key: 'total', value: 'TotalEnergies' },
  { key: 'totalenergies', value: 'TotalEnergies' },
  { key: 'ts', value: 'TS' },
  { key: 'westfalen', value: 'Westfalen' },
  { key: 'wiking', value: 'WIKING' },
  { key: 'wiro', value: 'wiro' },
];

function guessBrand(item) {
  const words = (item.brand || item.name).toLowerCase().split(' ');
  for (const { key, value } of brands) {
    for (const word of words) {
      if (word === key) {
        return value;
      }
    }
  }
  return null;
}

async function main() {
  const data = await readCsv('gasStations.csv', {
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

  for (const item of data) {
    item.brand = guessBrand(item);
    item.lat = parseFloat(item.lat);
    item.lng = parseFloat(item.lng);
  }

  const germany = {
    min: {
      lat: 47.2701114,
      lng: 5.8663153,
    },
    max: {
      lat: 55.099161,
      lng: 15.0419319,
    },
  };

  writeJson(
    '../src/data/gasStations.json',
    data
      .filter(
        (item) =>
          item.brand != null &&
          item.lat >= germany.min.lat &&
          item.lng >= germany.min.lng &&
          item.lat <= germany.max.lat &&
          item.lng <= germany.max.lng,
      )
      .map((item) => ({ name: item.brand, lat: item.lat, lng: item.lng })),
  );
}

main();
