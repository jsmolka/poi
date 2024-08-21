import * as turf from '@turf/turf';
import { readFileSync, writeFileSync } from 'fs';
import _ from 'lodash';
import { dirname, resolve } from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { inspect } from 'util';
import yargs from 'yargs/yargs';

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
      // https://developers.google.com/maps/documentation/places/web-service/nearby-search
      _.merge(
        {
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search#locationrestriction
          locationRestriction: {
            circle: {
              center: {
                latitude: null,
                longitude: null,
              },
              radius: null, // 0 - 50000
            },
          },
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search#includedtypesexcludedtypes,-includedprimarytypesexcludedprimarytypes
          // https://developers.google.com/maps/documentation/places/web-service/place-types#table-a
          excludedPrimaryTypes: [],
          excludedTypes: [],
          includedPrimaryTypes: [],
          includedTypes: [],
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search#languagecode
          // https://developers.google.com/maps/faq#languagesupport
          languageCode: null,
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search#maxresultcount
          // 1 - 2
          maxResultCount: null,
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search#rankpreference
          // 'DISTANCE' | 'POPULARITY'
          rankPreference: null,
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search#regioncode
          // https://www.unicode.org/cldr/charts/45/supplemental/territory_language_information.html
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

const leipzig = {
  lat: 51.34482272560187,
  lng: 12.381337332992878,
};

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

async function main(argv) {
  argv.index = Math.max(argv.index || 0, 0);
  argv.limit = Math.max(argv.limit || 0, 1);
  argv.threads = Math.max(argv.threads || 0, 1);

  let coordinates;
  let coordinateDistanceKm = 4;

  switch (argv.target) {
    case 'germany': {
      // prettier-ignore
      coordinates = turf.pointGrid(
        [
          germany.min.lng,
          germany.min.lat,
          germany.max.lng,
          germany.max.lat,
        ],
        coordinateDistanceKm,
        { units: 'kilometers' },
      );
      break;
    }

    case 'leipzig': {
      const circle = turf.circle([leipzig.lng, leipzig.lat], 150, {
        units: 'kilometers',
        steps: 256,
      });
      coordinates = turf.pointGrid(turf.bbox(circle), coordinateDistanceKm, {
        units: 'kilometers',
      });
      coordinates.features = coordinates.features.filter((point) =>
        turf.booleanPointInPolygon(point, circle),
      );
      break;
    }

    default: {
      console.error('Bad target', argv.target);
      return;
    }
  }

  coordinates = coordinates.features.map((point) => ({
    lat: point.geometry.coordinates[1],
    lng: point.geometry.coordinates[0],
  }));

  console.log('Coordinates:', coordinates.length);

  const file = relative('cemeteries.json');
  const cemeteries = JSON.parse(readFileSync(file));
  const cemeterySet = new Set();
  for (const cemetery of cemeteries) {
    cemeterySet.add(cemetery.id);
  }

  let i = argv.index;
  let iLimit = argv.index + argv.limit;
  let terminate = false;
  const threads = [];
  for (let thread = 0; thread < argv.threads; thread++) {
    const run = async () => {
      let index = -1;
      const browser = await puppeteer.launch({
        args: ['--incognito'],
      });
      try {
        const page = await browser.newPage();
        const client = new ScrapeClient(page);
        await client.init();

        while (!terminate) {
          index = i++;
          if (i >= iLimit) {
            terminate = true;
          }

          const latLng = coordinates[index];
          if (latLng == null) {
            return;
          }

          const response = await client.searchNearby({
            locationRestriction: {
              circle: {
                center: {
                  latitude: latLng.lat,
                  longitude: latLng.lng,
                },
                radius: (1000 * coordinateDistanceKm) / Math.sqrt(2),
              },
            },
            includedPrimaryTypes: ['cemetery'],
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
          });

          const places = response.places ?? [];
          console.log(`${index}: ${places.length} places at ${inspect(latLng)}`);
          for (const cemetery of places) {
            if (cemeterySet.has(cemetery.id)) {
              continue;
            }
            cemeterySet.add(cemetery.id);
            delete cemetery.accessibilityOptions;
            delete cemetery.adrFormatAddress;
            delete cemetery.businessStatus;
            delete cemetery.currentOpeningHours;
            delete cemetery.googleMapsUri;
            delete cemetery.iconBackgroundColor;
            delete cemetery.iconMaskBaseUri;
            delete cemetery.name;
            delete cemetery.photos;
            delete cemetery.plusCode;
            delete cemetery.rating;
            delete cemetery.regularOpeningHours?.openNow;
            delete cemetery.reviews;
            delete cemetery.userRating;
            delete cemetery.userRatingCount;
            delete cemetery.utcOffsetMinutes;
            delete cemetery.viewport;
            cemeteries.push(cemetery);
          }
        }
      } catch (error) {
        terminate = true;
        console.error(
          `Error in thread ${thread} at index ${index}`,
          inspect(error, false, null, true),
        );
      } finally {
        await browser.close();
      }
    };
    threads.push(run());
  }

  try {
    await Promise.all(threads);
  } finally {
    console.log('Save');
    writeFileSync(file, JSON.stringify(cemeteries, undefined, 2));
  }
}

main(
  yargs(process.argv.slice(2))
    .string('target')
    .default('target', 'germany')
    .number('index')
    .default('index', 0)
    .number('limit')
    .default('limit', 1500)
    .number('threads')
    .default('threads', 1)
    .parse(),
);
