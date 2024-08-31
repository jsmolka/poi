import cafesUrl from '@/assets/geojson/cafes.geojson?url';
import cemeteriesUrl from '@/assets/geojson/cemeteries.geojson?url';
import gasStationsUrl from '@/assets/geojson/gasStations.geojson?url';
import supermarketsUrl from '@/assets/geojson/supermarkets.geojson?url';
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
