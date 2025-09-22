import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.showDistanceMarker = true;
    this.cafes = false;
    this.cemeteries = false;
    this.gasStations = true;
    this.supermarkets = false;
  }
}

defineSchema(Settings, {
  showDistanceMarker: primitive(),
  cafes: primitive(),
  cemeteries: primitive(),
  gasStations: primitive(),
  supermarkets: primitive(),
});
