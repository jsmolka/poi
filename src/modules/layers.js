import cemeteriesUrl from '@/assets/geojson/cemeteries.geojson?url';
import confectioneriesUrl from '@/assets/geojson/confectioneries.geojson?url';
import gasStationsUrl from '@/assets/geojson/gasStations.geojson?url';
import supermarketsUrl from '@/assets/geojson/supermarkets.geojson?url';
import { colors } from '@/utils/colors';

export const layers = {
  gasStations: {
    url: gasStationsUrl,
    color: colors.red.hex,
    text: 'Gas station',
  },

  supermarkets: {
    url: supermarketsUrl,
    color: colors.orange.hex,
    text: 'Supermarket',
  },

  confectioneries: {
    url: confectioneriesUrl,
    color: colors.yellow.hex,
    text: 'Confectionary',
  },

  cemeteries: {
    url: cemeteriesUrl,
    color: colors.green.hex,
    text: 'Cemetery',
  },
};
