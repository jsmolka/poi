import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.cafes = true;
    this.cemeteries = true;
    this.gasStations = true;
    this.supermarkets = true;
  }
}

defineSchema(Settings, {
  cafes: primitive(),
  cemeteries: primitive(),
  gasStations: primitive(),
  supermarkets: primitive(),
});
