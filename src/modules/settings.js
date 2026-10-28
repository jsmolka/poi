import { Country } from '@/modules/country';
import { pois } from '@/modules/pois';
import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.showDistanceMarker = false;

    for (const value of Country.$values) {
      this[value] = value === Country.de;
    }
    for (const value of Object.keys(pois)) {
      this[value] = value === 'gasStations';
    }
  }
}

const schema = {
  showDistanceMarker: primitive(),
};
for (const value of Country.$values) {
  schema[value] = primitive();
}
for (const value of Object.keys(pois)) {
  schema[value] = primitive();
}

defineSchema(Settings, schema);
