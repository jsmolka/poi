import { defineSchema, primitive } from '@/utils/persist';

export class Settings {
  constructor() {
    this.gasStations = true;
    this.supermarkets = true;
    this.confectioneries = true;
    this.cemeteries = true;
    this.drinkingWater = true;
  }
}

defineSchema(Settings, {
  gasStations: primitive(),
  supermarkets: primitive(),
  confectioneries: primitive(),
  cemeteries: primitive(),
  drinkingWater: primitive(),
});
