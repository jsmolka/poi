import * as turf from '@turf/turf';
import _ from 'lodash';
import puppeteer from 'puppeteer';
import yargs from 'yargs/yargs';
import { inspect, parallelize, readJson, writeJson } from './common.js';

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
          locationRestriction: {
            circle: {
              center: {
                latitude: null,
                longitude: null,
              },
              radius: null,
            },
          },
          excludedPrimaryTypes: [],
          excludedTypes: [],
          includedPrimaryTypes: [],
          includedTypes: [],
          languageCode: null,
          maxResultCount: null,
          rankPreference: null,
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

async function browse(callback) {
  const browser = await puppeteer.launch({
    args: ['--incognito'],
  });
  try {
    await callback(browser);
  } finally {
    await browser.close();
  }
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

const leipzig = {
  lat: 51.34482272560187,
  lng: 12.381337332992878,
};

const coordinateDistanceKm = 8;

function createCoordinates(area) {
  let coordinates;
  switch (area) {
    case 'germany': {
      // prettier-ignore
      coordinates = turf.pointGrid(
        [
          germany.min.lng,
          germany.min.lat,
          germany.max.lng,
          germany.max.lat
        ],
        coordinateDistanceKm,
        { units: 'kilometers' },
      );
      break;
    }

    case 'leipzig': {
      // prettier-ignore
      const circle = turf.circle(
        [leipzig.lng, leipzig.lat],
        150,
        { units: 'kilometers', steps: 256 },
      );
      // prettier-ignore
      coordinates = turf.pointGrid(
        turf.bbox(circle),
        coordinateDistanceKm,
        { units: 'kilometers' },
      );
      coordinates.features = coordinates.features.filter((point) =>
        turf.booleanPointInPolygon(point, circle),
      );
      break;
    }

    default: {
      throw `Bad area: ${area}`;
    }
  }

  return coordinates.features.map((point) => ({
    lat: point.geometry.coordinates[1],
    lng: point.geometry.coordinates[0],
  }));
}

async function rasterize(center, sizeKm, callback) {
  const centers = Array.isArray(center) ? center : [center];
  for (const center of centers) {
    if (await callback(center, sizeKm)) {
      continue;
    }

    const newSizeKm = sizeKm / 2;
    const bbox = turf.bbox(
      turf.circle([center.lng, center.lat], newSizeKm, { units: 'kilometers' }),
    );
    await rasterize(
      [
        { lat: bbox[1], lng: bbox[0] },
        { lat: bbox[3], lng: bbox[0] },
        { lat: bbox[3], lng: bbox[2] },
        { lat: bbox[1], lng: bbox[2] },
      ],
      newSizeKm,
      callback,
    );
  }
}

async function main(argv) {
  const places = readJson(argv.file);
  const placeSet = new Set(places.map((place) => place.id));
  console.assert(places.length === placeSet.size);

  const coordinates = createCoordinates(argv.area);
  console.log('Coordinates:', coordinates.length);

  let r = 0;
  let i = argv.index;
  try {
    await parallelize(argv.threads, async ({ thread, terminate, isTerminated }) => {
      await browse(async (browser) => {
        let index = -1;
        try {
          const page = await browser.newPage();
          const client = new ScrapeClient(page);
          await client.init();

          while (!isTerminated()) {
            index = i++;
            const center = coordinates[index];
            if (center == null) {
              return;
            }

            let ri = 0;
            await rasterize(center, coordinateDistanceKm, async (center, sizeKm) => {
              const maxResultCount = 20;
              const response = await client.searchNearby({
                locationRestriction: {
                  circle: {
                    center: {
                      latitude: center.lat,
                      longitude: center.lng,
                    },
                    radius: sizeKm / Math.SQRT2,
                  },
                },
                includedPrimaryTypes: [argv.primaryType],
                maxResultCount,
                rankPreference: 'DISTANCE',
              });

              r++;
              ri++;
              if (r >= argv.limit) {
                terminate();
              }

              const nearbyPlaces = response.places ?? [];
              console.log(
                `${index}: request ${r}, size ${size}, ${nearbyPlaces.length} places, center`,
                center,
              );
              for (const place of nearbyPlaces) {
                if (placeSet.has(place.id)) {
                  continue;
                }

                placeSet.add(place.id);
                delete place.accessibilityOptions;
                delete place.adrFormatAddress;
                delete place.businessStatus;
                delete place.currentOpeningHours;
                delete place.googleMapsUri;
                delete place.iconBackgroundColor;
                delete place.iconMaskBaseUri;
                delete place.name;
                delete place.photos;
                delete place.plusCode;
                delete place.rating;
                delete place.regularOpeningHours?.openNow;
                delete place.reviews;
                delete place.userRating;
                delete place.userRatingCount;
                delete place.utcOffsetMinutes;
                delete place.viewport;
                places.push(place);
              }
              return nearbyPlaces.length < maxResultCount;
            });
            console.log(`${index}: done in ${ri} requests`);
          }
        } catch (error) {
          terminate();
          console.error(`Error in thread ${thread} at index ${index}`, inspect(error));
        }
      });
    });
  } finally {
    writeJson(argv.file, places);
    console.log('Saved to', argv.file);
  }
}

main(
  yargs(process.argv.slice(2))
    .option('file', {
      type: 'string',
      requiresArg: true,
    })
    .option('primaryType', {
      type: 'string',
      requiresArg: true,
    })
    .option('area', {
      type: 'string',
      default: 'germany',
    })
    .option('index', {
      type: 'number',
      default: 0,
    })
    .option('limit', {
      type: 'number',
      default: 1500,
    })
    .option('threads', {
      type: 'number',
      default: 1,
    })
    .parse(),
);
