import cemeteriesUrl from '@/assets/geojson/cemeteries.geojson?url';
import confectioneriesUrl from '@/assets/geojson/confectioneries.geojson?url';
import drinkingWaterUrl from '@/assets/geojson/drinkingWater.geojson?url';
import gasStationsUrl from '@/assets/geojson/gasStations.geojson?url';
import supermarketsUrl from '@/assets/geojson/supermarkets.geojson?url';
import { colors } from '@/utils/colors';

export const layers = [
  {
    key: 'gasStations',
    url: gasStationsUrl,
    title: 'Gas stations',
    color: colors.shade2.hex,
  },
  {
    key: 'supermarkets',
    url: supermarketsUrl,
    title: 'Supermarkets',
    color: colors.red.hex,
  },
  {
    key: 'confectioneries',
    url: confectioneriesUrl,
    title: 'Confectioneries',
    color: colors.yellow.hex,
  },
  {
    key: 'cemeteries',
    url: cemeteriesUrl,
    title: 'Cemeteries',
    color: colors.green.hex,
  },
  {
    key: 'drinkingWater',
    url: drinkingWaterUrl,
    title: 'Drinking water',
    color: colors.brand3.hex,
  },
];
