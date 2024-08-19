import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.isInterceptResolutionHandled()) {
      return;
    }
    if (!request.url().endsWith('/api/data')) {
      request.continue();
      return;
    }

    const postData = JSON.parse(request.postData());
    postData.request.rankPreference = 'DISTANCE';
    postData.request.maxResultCount = 3;
    postData.request.includedPrimaryTypes = ['cemetery'];
    postData.request.locationRestriction.circle.center.latitude = 51.0928251316323;
    postData.request.locationRestriction.circle.center.longitude = 12.377495829906103;
    request.continue({
      postData: JSON.stringify(postData),
    });
  });
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/data')) {
      for (const place of (await response.json()).places) {
        console.log(place.displayName.text);
        console.log(place);
      }
    }
  });

  await page.goto('https://places-search-405409.ue.r.appspot.com/');
  await browser.close();
}

main();
