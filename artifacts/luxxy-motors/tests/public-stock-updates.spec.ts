import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional browser response only; no saved stock changes.');

for (const width of [390, 834, 1440]) test(`verified customer price reduction at ${width}`, async ({page, request}) => {
  await page.setViewportSize({width, height:1000});
  const {cars} = await (await request.get('/api/stock')).json() as {cars: {
    id: string; price: number | null; inventoryStatus?: string; sourceExtras?: Record<string, unknown>;
  }[]};
  const target = cars.find(car => car.price && (!car.inventoryStatus || car.inventoryStatus === 'available'))!;
  const {id} = target;
  const previousPrice = target.price! + 500;
  const offer = {
    ...target,
    sourceExtras: {...target.sourceExtras, websitePriceReduction:{
      previousPrice, currentPrice: target.price,
      detectedAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }},
  };
  const errors:string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => ['GET','HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.route('**/api/stock', async route => {
    const response = await route.fetch();
    const stock = await response.json();
    await route.fulfill({response,json:{...stock, cars:stock.cars.map((car:{id:string}) => car.id === id ? offer : car)}});
  });
  await page.route(`**/api/vehicles/${id}`, route => route.fulfill({json:offer}));
  await page.goto('/stock');
  const cardReduction = page.getByTestId('stock-photo-badge').filter({hasText:'Price drop'}).filter({hasText:'-£500'}).first();
  await expect(cardReduction).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.goto(`/vehicle/${id}`);
  const reduction = page.getByTestId('price-reduction');
  await expect(reduction).toBeVisible();
  await expect(reduction).toContainText(`Was £${previousPrice.toLocaleString('en-GB')}`);
  await expect(reduction).toContainText('Save £500');
  await expect(reduction).toContainText('Reduced');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`/tmp/luxxy-public-stock-update-${width}.png`,fullPage:true});
  await page.goto('/stock');
  await expect(page.getByRole('heading',{name:'Recently viewed',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
