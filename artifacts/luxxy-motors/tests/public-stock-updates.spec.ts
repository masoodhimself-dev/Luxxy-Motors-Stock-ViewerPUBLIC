import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional browser response only; no saved stock changes.');

for (const width of [390, 834, 1440]) test(`verified customer price reduction and recent browsing at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height:1000});
  const id = '27be77df-87ce-4557-8b61-0a24d9092b76';
  const errors:string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => ['GET','HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.route('**/api/stock', async route => {
    const response = await route.fetch();
    const stock = await response.json();
    const car = stock.cars.find((vehicle:{id:string}) => vehicle.id === id);
    expect(car).toBeTruthy();
    car.sourceExtras = {...car.sourceExtras, websitePriceReduction:{
      previousPrice:car.price + 500, currentPrice:car.price,
      detectedAt:new Date(Date.now()-3600000).toISOString(),
      expiresAt:new Date(Date.now()+86400000).toISOString(),
    }};
    await route.fulfill({response,json:stock});
  });
  await page.goto('/stock');
  const cardReduction = page.getByTestId('price-reduction').first();
  await expect(cardReduction).toContainText('Price reduced');
  await expect(cardReduction).toContainText('Was £4,375');
  await expect(cardReduction).toContainText('Save £500');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.goto(`/vehicle/${id}`);
  const reduction = page.getByTestId('price-reduction');
  await expect(reduction).toBeVisible();
  await expect(reduction).toContainText('Price change recorded');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`/tmp/luxxy-public-stock-update-${width}.png`,fullPage:true});
  await page.goto('/stock');
  const recent = page.locator('section').filter({has:page.getByRole('heading',{name:'Recently viewed',exact:true})});
  await expect(recent.getByRole('link').filter({hasText:'Nissan Qashqai'})).toBeVisible();
  await recent.getByRole('button',{name:'Clear viewing history'}).click();
  await expect(page.getByRole('heading',{name:'Recently viewed',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
