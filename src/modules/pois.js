import { colors } from '@/utils/colors';

function transform(assets) {
  return Object.fromEntries(
    Object.entries(assets).map(([path, url]) => {
      const country = path
        .split('/')
        .pop()
        .replace(/\.bin$/, '');
      return [country, url];
    }),
  );
}

export const pois = {
  gasStations: {
    type: 'poi',
    name: 'Gas Station',
    color: colors.red,
    urls: transform(
      import.meta.glob('@/assets/data/gasStations/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },

  supermarkets: {
    type: 'poi',
    name: 'Supermarket',
    color: colors.orange,
    urls: transform(
      import.meta.glob('@/assets/data/supermarkets/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },

  cafes: {
    type: 'poi',
    name: 'Cafe/Bakery',
    color: colors.yellow,
    urls: transform(
      import.meta.glob('@/assets/data/cafes/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },

  cemeteries: {
    type: 'poi',
    name: 'Cemetery',
    color: colors.green,
    urls: transform(
      import.meta.glob('@/assets/data/cemeteries/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },

  drinkingWater: {
    type: 'poi',
    name: 'Water',
    color: colors.brand3,
    urls: transform(
      import.meta.glob('@/assets/data/water/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },

  cobblestones: {
    type: 'way',
    name: 'Cobblestones',
    color: colors.purple,
    urls: transform(
      import.meta.glob('@/assets/data/cobblestones/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },

  gravel: {
    type: 'way',
    name: 'Gravel',
    color: colors.brown,
    urls: transform(
      import.meta.glob('@/assets/data/gravel/*.bin', {
        eager: true,
        query: '?url',
        import: 'default',
      }),
    ),
  },
};
