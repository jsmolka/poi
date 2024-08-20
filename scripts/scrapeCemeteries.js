import { pointGrid } from '@turf/point-grid';
import { readFileSync, writeFileSync } from 'fs';
import _ from 'lodash';
import { dirname, resolve } from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const dataApi = /.*\/api\/data/;

class ScrapeClient {
  constructor(page) {
    this.page = page;
  }

  async init() {
    await this.page.setRequestInterception(true);
    this.interceptRequest();
    await this.page.goto('https://places-search-405409.ue.r.appspot.com/');
    await this.interceptDataResponse();
  }

  interceptRequest() {
    this.page.on('request', (request) => {
      if (request.isInterceptResolutionHandled()) {
        return;
      }
      request.continue();
    });
  }

  interceptDataRequest(parameters) {
    const intercept = async (request) => {
      if (request.isInterceptResolutionHandled()) {
        return;
      }
      if (dataApi.test(request.url())) {
        this.page.off('request', intercept);
        const postData = JSON.parse(request.postData());
        postData.request = parameters;
        request.continue({ postData: JSON.stringify(postData) });
      }
    };
    this.page.off('request');
    this.page.on('request', intercept);
    this.interceptRequest();
  }

  async interceptDataResponse() {
    return new Promise((resolve, reject) => {
      const intercept = async (response) => {
        if (dataApi.test(response.url())) {
          this.page.off('response', intercept);
          const json = await response.json();
          if (response.status() === 200) {
            resolve(json);
          } else {
            reject(json);
          }
        }
      };
      this.page.off('response');
      this.page.on('response', intercept);
    });
  }

  async searchNearby(parameters = {}) {
    this.interceptDataRequest(
      // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
      _.merge(
        {
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search#locationrestriction)
          locationRestriction: {
            circle: {
              center: {
                latitude: null,
                longitude: null,
              },
              radius: null, // 0 - 50000
            },
          },
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search#includedtypesexcludedtypes,-includedprimarytypesexcludedprimarytypes)
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/place-types#table-a)
          excludedPrimaryTypes: [],
          excludedTypes: [],
          includedPrimaryTypes: [],
          includedTypes: [],
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search#languagecode)
          // [Google Maps](https://developers.google.com/maps/faq#languagesupport)
          languageCode: null,
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search#maxresultcount)
          // 1 - 2
          maxResultCount: null,
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search#rankpreference)
          // 'DISTANCE' | 'POPULARITY'
          rankPreference: null,
          // [Google Maps](https://developers.google.com/maps/documentation/places/web-service/nearby-search#regioncode)
          // [Territory-Language Information](https://www.unicode.org/cldr/charts/45/supplemental/territory_language_information.html)
          regionCode: null,
        },
        parameters,
      ),
    );
    const promise = this.interceptDataResponse();
    await this.page.click('#search');
    return await promise;
  }
}

function relative(...paths) {
  const cwd = dirname(fileURLToPath(import.meta.url));
  return resolve(cwd, ...paths);
}

async function main() {
  const file = relative('cemeteries.json');
  const cemeteries = JSON.parse(readFileSync(file));
  const cemeterySet = new Set();
  for (const cemetery of cemeteries) {
    cemeterySet.add(cemetery.id);
  }

  const germany = {
    min: {
      lat: 47.2701114,
      lng: 5.8663153,
    },
    max: {
      lat: 55.099161,
      lng: 15.0419319,
    },
  };

  // SN, ST, TH
  const federalStates = {
    min: {
      lat: 50.17140289225376,
      lng: 10.560559830845426,
    },
    max: {
      lat: 53.04188377888388,
      lng: 15.0419319,
    },
  };

  const gridSize = 4;
  const grid = pointGrid(
    [federalStates.min.lng, federalStates.min.lat, federalStates.max.lng, federalStates.max.lat],
    gridSize,
    { units: 'kilometers' },
  ).features.map((point) => ({
    lat: point.geometry.coordinates[1],
    lng: point.geometry.coordinates[0],
  }));

  let i = 0;
  let terminate = false;
  const threads = [];
  for (let thread = 0; thread < 1; thread++) {
    const work = async () => {
      let index = -1;
      const browser = await puppeteer.launch();
      try {
        const page = await browser.newPage();
        const client = new ScrapeClient(page);
        await client.init();

        while (!terminate) {
          index = i++;
          const coordinates = grid[index];
          const response = await client.searchNearby({
            locationRestriction: {
              circle: {
                center: {
                  latitude: coordinates.lat,
                  longitude: coordinates.lng,
                },
                radius: gridSize / Math.sqrt(2),
              },
            },
            includedPrimaryTypes: ['cemetery'],
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
          });

          console.log(`${i}: ${response.places.length} at ${coordinates}`);
          for (const cemetery in response.places) {
            if (cemeterySet.has(cemetery.id)) {
              continue;
            }
            cemeterySet.add(cemetery.id);
            cemeteries.push(cemetery);
          }
        }
      } catch (error) {
        terminate = true;
        console.error(`Error in thread ${thread} at index ${index}`, error);
      } finally {
        await browser.close();
      }
    };
    threads.push(work());
  }

  await Promise.all(threads);

  writeFileSync(file, JSON.stringify(cemeteries, undefined, 2));
}

main();
