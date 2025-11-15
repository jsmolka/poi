import { colors } from '@/utils/colors';

export const layers = {
  gasStations: {
    text: 'Gas Station',
    color: colors.red.hex,
    url: new URL('@/assets/data/gasStations.bin', import.meta.url),
  },

  supermarkets: {
    text: 'Supermarket',
    color: colors.orange.hex,
    url: new URL('@/assets/data/supermarkets.bin', import.meta.url),
  },

  cafes: {
    text: 'Cafe/Bakery',
    color: colors.yellow.hex,
    url: new URL('@/assets/data/cafes.bin', import.meta.url),
  },

  cemeteries: {
    text: 'Cemetery',
    color: colors.green.hex,
    url: new URL('@/assets/data/cemeteries.bin', import.meta.url),
  },
};
