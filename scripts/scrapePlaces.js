import * as turf from '@turf/turf';
import _ from 'lodash';
import puppeteer from 'puppeteer';
import yargs from 'yargs/yargs';
import { inspect, readJson, writeJson } from './common.js';

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
          try {
            const json = await response.json();
            if (response.status() === 200) {
              resolve(json);
            } else {
              reject(json);
            }
          } catch (error) {
            reject(error);
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
          languageCode: 'de',
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

function createCoordinates(area, rasterKm) {
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
        rasterKm,
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
        rasterKm,
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

async function parallelize(threadCount, callback) {
  let terminated = false;

  const terminate = () => {
    terminated = true;
  };

  const isTerminated = () => {
    return terminated;
  };

  const threads = [];
  for (let thread = 0; thread < threadCount; thread++) {
    const job = async () => {
      return await callback({ thread, terminate, isTerminated });
    };
    threads.push(job());
  }
  return await Promise.all(threads);
}

async function rasterize(center, rasterKm, callback) {
  const centers = Array.isArray(center) ? center : [center];
  for (const center of centers) {
    if (await callback(center, rasterKm)) {
      continue;
    }

    const newRasterKm = rasterKm / 2;
    const bbox = turf.bbox(
      turf.circle([center.lng, center.lat], newRasterKm, { units: 'kilometers' }),
    );
    await rasterize(
      [
        { lat: bbox[1], lng: bbox[0] },
        { lat: bbox[3], lng: bbox[0] },
        { lat: bbox[3], lng: bbox[2] },
        { lat: bbox[1], lng: bbox[2] },
      ],
      newRasterKm,
      callback,
    );
  }
}

async function main(argv) {
  const places = readJson(argv.file);
  const placeCount = places.length;
  const placeSet = new Set(places.map((place) => place.id));
  console.assert(places.length === placeSet.size);

  const coordinates = createCoordinates(argv.area, argv.raster);
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
            let nearbyPlacesCount = 0;
            await rasterize(center, argv.raster, async (center, rasterKm) => {
              const maxResultCount = 20;
              const response = await client.searchNearby({
                locationRestriction: {
                  circle: {
                    center: {
                      latitude: center.lat,
                      longitude: center.lng,
                    },
                    radius: (1000 * rasterKm) / Math.SQRT2,
                  },
                },
                includedPrimaryTypes: argv.primaryTypes,
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
                `${index}: request ${r}, raster ${rasterKm}, ${nearbyPlaces.length} places`,
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

              if (nearbyPlaces.length < maxResultCount) {
                nearbyPlacesCount += nearbyPlaces.length;
                return true;
              } else {
                return false;
              }
            });
            console.log(`${index}: ${nearbyPlacesCount} places in ${ri} requests`);
          }
        } catch (error) {
          terminate();
          console.error(`Error in thread ${thread} at index ${index}`, inspect(error));
        }
      });
    });
  } finally {
    writeJson(argv.file, places);
    console.log(`Added ${places.length - placeCount} places in ${r} requests`);
  }
}

main(
  yargs(process.argv.slice(2))
    .option('primaryTypes', {
      type: 'array',
      demandOption: true,
    })
    .option('file', {
      type: 'string',
      default: 'places.json',
    })
    .option('area', {
      type: 'string',
      default: 'germany',
    })
    .option('raster', {
      type: 'number',
      default: 8,
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
