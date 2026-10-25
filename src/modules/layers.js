import { colors } from '@/utils/colors';

export const layers = {
  gasStations: {
    type: 'poi',
    name: 'Gas Station',
    color: colors.red.hex,
    url: new URL('@/assets/data/gasStations.bin', import.meta.url),
  },

  supermarkets: {
    type: 'poi',
    name: 'Supermarket',
    color: colors.orange.hex,
    url: new URL('@/assets/data/supermarkets.bin', import.meta.url),
  },

  cafes: {
    type: 'poi',
    name: 'Cafe/Bakery',
    color: colors.yellow.hex,
    url: new URL('@/assets/data/cafes.bin', import.meta.url),
  },

  cemeteries: {
    type: 'poi',
    name: 'Cemetery',
    color: colors.green.hex,
    url: new URL('@/assets/data/cemeteries.bin', import.meta.url),
  },

  drinkingWater: {
    type: 'poi',
    name: 'Water',
    color: colors.brand3.hex,
    url: new URL('@/assets/data/water.bin', import.meta.url),
  },

  cobblestones: {
    type: 'way',
    name: 'Cobblestones',
    color: colors.purple.hex,
    url: new URL('@/assets/data/cobblestones.bin', import.meta.url),
  },
};

export const routeId = 'route';

export const layerIds = [
  routeId,

  ...Object.entries(layers)
    .filter(([_, { type }]) => type === 'way')
    .map(([key]) => key),

  ...Object.entries(layers)
    .filter(([_, { type }]) => type === 'poi')
    .map(([key]) => key),
];
