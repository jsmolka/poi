import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.showDistanceMaker = false;
    this.cafes = false;
    this.cemeteries = false;
    this.gasStations = true;
    this.supermarkets = false;
    this.drinkingWater = false;
    this.blacklist = false;
  }
}

defineSchema(Settings, {
  showDistanceMaker: primitive(),
  cafes: primitive(),
  cemeteries: primitive(),
  gasStations: primitive(),
  supermarkets: primitive(),
  drinkingWater: primitive(),
  blacklist: primitive(),
});
