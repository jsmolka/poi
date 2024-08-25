import cemeteriesUrl from '@/assets/geojson/cemeteries.geojson?url';
import confectioneriesUrl from '@/assets/geojson/confectioneries.geojson?url';
import drinkingWaterUrl from '@/assets/geojson/drinkingWater.geojson?url';
import gasStationsUrl from '@/assets/geojson/gasStations.geojson?url';
import supermarketsUrl from '@/assets/geojson/supermarkets.geojson?url';
import { colors } from '@/utils/colors';

export const layers = {
  gasStations: {
    url: gasStationsUrl,
    color: colors.shade2.hex,
    textSingular: 'Gas station',
    textPlural: 'Gas stations',
  },

  supermarkets: {
    url: supermarketsUrl,
    color: colors.red.hex,
    textSingular: 'Supermarket',
    textPlural: 'Supermarkets',
  },

  confectioneries: {
    url: confectioneriesUrl,
    color: colors.yellow.hex,
    textSingular: 'Confectionary',
    textPlural: 'Confectioneries',
  },

  cemeteries: {
    url: cemeteriesUrl,
    color: colors.green.hex,
    textSingular: 'Cemetery',
    textPlural: 'Cemeteries',
  },

  drinkingWater: {
    url: drinkingWaterUrl,
    color: colors.brand3.hex,
    textSingular: 'Drinking water',
    textPlural: 'Drinking water',
  },
};
