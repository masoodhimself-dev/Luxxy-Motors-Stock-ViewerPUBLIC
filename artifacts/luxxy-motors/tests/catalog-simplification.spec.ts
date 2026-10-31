import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const photo = 'https://images.example.com/catalog-simplification.svg';
const output = fileURLToPath(new URL('../../../output/settings-simplification/catalog/', import.meta.url));

async function fictionalStock(page: Page) {
  const stock = await (await page.request.get('/api/stock')).json();
  const base = {...stock.cars[0], heroImage: photo, images: [{url:photo,caption:'Front exterior'}], imageCount:1, specifications:null, writeOffCategory:null, inventoryStatus:'available', currency:'GBP'};
  const first = {...base, id:'catalog-toyota',advertId:'catalog-toyota',title:'Toyota Yaris',make:'Toyota',model:'Yaris',year:2019,price:4250,mileage:45000,fuel:'Petrol',transmission:'Automatic',colour:'Black',sourceExtras:{description:'This car is recorded as Cat S. Ask for the available repair records.',features:['Apple CarPlay']}};
  const second = {...base,id:'catalog-honda',advertId:'catalog-honda',title:'Honda Jazz',make:'Honda',model:'Jazz',year:2022,price:19995,mileage:9000,fuel:'Petrol',transmission:'Manual',sourceExtras:{description:'This is not recorded as Cat N.'}};
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(photo, route => route.fulfill({contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e8edf0"/><path d="M130 390h540l-45-95H225z" fill="#285a76"/><circle cx="250" cy="405" r="45" fill="#263c46"/><circle cx="575" cy="405" r="45" fill="#263c46"/><text x="400" y="180" text-anchor="middle" fill="#263c46" font-size="28">Fictional car for layout testing</text></svg>'}));
  await page.route('**/api/**', route => {
    if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) {writes.push(route.request().url()); return route.abort();}
    if (new URL(route.request().url()).pathname === '/api/stock') return route.fulfill({json:{...stock,cars:[first,second],count:2}});
    return route.continue();
  });
  return {first,second,writes,errors};
}

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const width of [320,390,820,1440]) {
  test(`catalog filters and contextual enquiry at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:1000});
    const {first,second,writes,errors} = await fictionalStock(page);
    await page.goto('/');
    await expect(page.getByRole('button',{name:'Search 2 cars'})).toBeVisible();
    const budget = page.getByLabel('Search maximum price');
    await expect(budget.locator('option')).toHaveText(['No limit','£5,000','£10,000','£15,000','£20,000']);
    await expect(page.getByRole('link',{name:'See all cars',exact:true})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'View all stock',exact:true})).toHaveCount(1);
    await expect(page.locator('.rolling-stock-group').getByText('Advert states Category S')).toBeVisible();
    await fits(page);
    await page.screenshot({path:`${output}/home-${width}.png`});

    await page.goto('/stock?maxPrice=12345');
    await expect(page.getByLabel('Quick filter by maximum price')).toHaveValue('12345');
    await expect(page.getByTestId(`card-vehicle-${first.id}`)).toBeVisible();
    await expect(page.getByTestId(`card-vehicle-${second.id}`)).toHaveCount(0);
    await page.getByTestId(`card-vehicle-${first.id}`).getByRole('button',{name:'Advert states Category S',exact:true}).click();
    await expect(page.getByRole('tooltip')).toContainText('structured insurance-history field has not confirmed that category');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Advanced search'}).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button',{name:'Automatic',exact:true})).toHaveCount(0);
    await expect(dialog.getByRole('button',{name:/Under £/})).toHaveCount(0);
    await dialog.getByLabel('Transmission',{exact:true}).selectOption('Automatic');
    await dialog.getByLabel('Max budget',{exact:true}).selectOption('15000');
    await expect(dialog).toBeVisible();
    await fits(page);
    await page.screenshot({path:`${output}/filters-${width}.png`});
    await dialog.getByRole('button',{name:'Show 1 car',exact:true}).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/maxPrice=15000/);
    await expect(page).toHaveURL(/transmission=Automatic/);
    await expect(page.getByRole('button',{name:'Show automatic cars'})).toBeVisible();
    await page.getByTestId(`card-vehicle-${first.id}`).getByRole('link',{name:'View full details for Toyota Yaris',exact:true}).click();
    await expect(page.locator('.vehicle-price-block')).toContainText('Advert states Category S');
    await expect(page.locator('.vehicle-key-facts').getByRole('button',{name:/^(Mileage|Fuel|Year)/})).toHaveCount(0);
    await page.getByRole('link',{name:'Ask a question',exact:true}).click();
    await page.getByRole('dialog',{name:'Questions about this Toyota Yaris'}).getByRole('button',{name:'Ask our team'}).click();
    await expect(page.getByRole('heading',{name:'Enquire about this Toyota Yaris'})).toBeFocused();
    await expect(page.getByTestId('textarea-enquiry-message')).toBeVisible();
    await expect(page).toHaveURL(`/vehicle/${first.id}`);
    await fits(page);
    await page.screenshot({path:`${output}/vehicle-enquiry-${width}.png`});
    await page.getByRole('button',{name:'View gallery fullscreen',exact:true}).click();
    const gallery = page.getByRole('dialog');
    await gallery.getByRole('link',{name:'Message',exact:true}).click();
    await expect(gallery).toBeHidden();
    await expect(page.getByRole('heading',{name:'Enquire about this Toyota Yaris'})).toBeFocused();
    await expect(page).toHaveURL(`/vehicle/${first.id}`);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });

  test(`compact shortlist preserves saved and stock updates at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:1000});
    const {first,second,writes,errors} = await fictionalStock(page);
    await page.addInitScript(({first,second}) => {
      localStorage.setItem('luxxy.saved-cars.v1', JSON.stringify([first.id,second.id,'catalog-unavailable']));
      localStorage.setItem('luxxy.saved-car-snapshots.v1', JSON.stringify({[first.id]:{title:first.title,photo:first.heroImage,price:5000,currency:'GBP',status:'available',savedAt:new Date().toISOString()},'catalog-unavailable':{title:'Previously saved fictional car',photo:first.heroImage,price:2000,currency:'GBP',status:'available',savedAt:new Date().toISOString()}}));
    },{first,second});
    await page.goto('/saved');
    await expect(page.getByTestId('text-saved-count')).toHaveText('2 cars saved');
    await expect(page.getByText('Price reduced by £750 since you saved it')).toBeVisible();
    await expect(page.getByText('One saved car is no longer in stock.')).toBeVisible();
    await expect(page.locator('.saved-car-list details')).toHaveCount(0);
    await expect(page.locator('.saved-car-list').getByRole('link',{name:'View vehicle',exact:true})).toHaveCount(2);
    await expect(page.locator('.saved-car-list')).toContainText('Advert states Category S');
    await expect(page.getByRole('button',{name:'Share shortlist',exact:true})).toBeVisible();
    await fits(page);
    await page.locator('.saved-car-list').screenshot({path:`${output}/saved-${width}.png`});
    await page.goto(`/saved?cars=${first.id},${second.id}`);
    await expect(page.getByRole('heading',{name:'Shared shortlist',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'View my saved cars',exact:true})).toBeVisible();
    await expect(page.locator('.saved-car-list details')).toHaveCount(0);
    await page.getByTestId(`compact-vehicle-${first.id}`).getByRole('link',{name:'View vehicle',exact:true}).click();
    await expect(page).toHaveURL(`/vehicle/${first.id}`);
    await expect(page.locator('.vehicle-description-copy')).toContainText('This car is recorded as Cat S.');
    await fits(page);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}
