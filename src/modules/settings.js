import { layers } from '@/modules/layers';
import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.showDistanceMarker = false;
    for (const key of Object.keys(layers)) {
      this[key] = false;
    }
  }
}

const schema = {
  showDistanceMarker: primitive(),
};
for (const key of Object.keys(layers)) {
  schema[key] = primitive();
}

defineSchema(Settings, schema);
