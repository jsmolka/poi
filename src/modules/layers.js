import { colors } from '@/utils/colors';

export const layers = {
  gasStations: {
    text: 'Gas Station',
    color: colors.red.hex,
    url: new URL('@/assets/data/gasStations.json', import.meta.url),
  },

  supermarkets: {
    text: 'Supermarket',
    color: colors.orange.hex,
    url: new URL('@/assets/data/supermarkets.json', import.meta.url),
  },

  cafes: {
    text: 'Cafe/Bakery',
    color: colors.yellow.hex,
    url: new URL('@/assets/data/cafes.json', import.meta.url),
  },

  cemeteries: {
    text: 'Cemetery',
    color: colors.green.hex,
    url: new URL('@/assets/data/cemeteries.json', import.meta.url),
  },

  // Underscore to prevent clashing with internal Mapbox layer names
  _water: {
    text: 'Water',
    color: colors.brand3.hex,
    url: new URL('@/assets/data/water.json', import.meta.url),
  },

  blacklist: {
    text: 'Blacklist',
    color: colors.shade3.hex,
    url: new URL('@/assets/data/blacklist.json', import.meta.url),
  },
};

const orderedIds = [...Object.keys(layers), 'route'];

export function addDataLayer(map, layer) {
  map.addDataLayer(layer);

  for (const id of orderedIds) {
    if (map.getLayer(id)) {
      map.moveLayer(id);
    }
  }
}
