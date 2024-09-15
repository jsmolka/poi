import cafesUrl from '@/assets/data/cafes.json?url';
import cemeteriesUrl from '@/assets/data/cemeteries.json?url';
import gasStationsUrl from '@/assets/data/gasStations.json?url';
import supermarketsUrl from '@/assets/data/supermarkets.json?url';
import { colors } from '@/utils/colors';

export const layers = {
  gasStations: {
    url: gasStationsUrl,
    color: colors.red.hex,
    text: 'Gas Station',
  },

  supermarkets: {
    url: supermarketsUrl,
    color: colors.orange.hex,
    text: 'Supermarket',
  },

  cafes: {
    url: cafesUrl,
    color: colors.yellow.hex,
    text: 'Cafe/Bakery',
  },

  cemeteries: {
    url: cemeteriesUrl,
    color: colors.green.hex,
    text: 'Cemetery',
  },
};
