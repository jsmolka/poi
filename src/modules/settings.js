import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.cafes = false;
    this.cemeteries = false;
    this.gasStations = true;
    this.supermarkets = false;
  }
}

defineSchema(Settings, {
  cafes: primitive(),
  cemeteries: primitive(),
  gasStations: primitive(),
  supermarkets: primitive(),
});
