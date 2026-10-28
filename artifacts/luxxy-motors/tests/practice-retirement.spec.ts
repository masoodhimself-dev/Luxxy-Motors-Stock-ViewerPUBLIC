import { expect, test } from '@playwright/test';

for (const width of [390, 820, 1440]) {
  test(`normal portal and customer booking remain usable without practice mode at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.clock.install({ time: new Date('2026-10-28T08:00:00Z') });
    const practiceRequests: string[] = [];
    const writes: string[] = [];
    page.on('request', req => { if (/\/api\/(sales-test|test-email-settings)/.test(req.url())) practiceRequests.push(req.url()); });
    await page.route('**/*', route => {
      const req=route.request();
      if (!req.url().startsWith('http://127.0.0.1:4271/')) return route.abort();
      if (req.url().includes('/api/') && !['GET','HEAD'].includes(req.method())) {
        writes.push(req.url());
        return route.fulfill({status:403,json:{error:'Browser check blocks writes.'}});
      }
      return route.continue();
    });
    await page.route('**/api/enquiries/availability?*', route => {
      const date=new URL(route.request().url()).searchParams.get('date');
      return route.fulfill({json:{date,timezone:'Europe/London',slots:[{label:'10:00 am',startAt:`${date}T10:00:00.000Z`,available:true}]}});
    });
    await page.goto('/portal?section=reports');
    const nav=page.getByRole('navigation',{name:'Portal sections'});
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button')).toHaveText(['Inbox','Sales','Settings']);
    await expect(page.getByRole('button',{name:/test mode|start test|practice/i})).toHaveCount(0);
    await page.getByRole('button',{name:'Quick actions'}).click();
    await expect(page.getByRole('menuitem',{name:'Quick enquiry'})).toBeVisible();
    await expect(page.getByRole('menuitem',{name:/test|practice/i})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await nav.getByRole('button',{name:'Sales',exact:true}).click();
    await expect(page.getByRole('button',{name:'New invoice',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'New invoice',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Which car are you selling?'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`/private/tmp/luxxy-practice-removed-sales-${width}.png`,fullPage:true});
    const stock=await (await request.get('/api/stock')).json();
    const car=stock.cars.find((car:any)=>!car.inventoryStatus||car.inventoryStatus==='available');
    expect(car).toBeTruthy();
    await page.goto(`/vehicle/${car.id}`);
    await expect(page.getByRole('heading',{level:1})).toContainText(car.model || car.title.replace(/^\d{4}\s+/,''));
    const save=page.getByRole('button',{name:/^Save .* to your saved cars$/});
    await save.click();
    await page.goto('/saved');
    await expect(page.locator('main')).toContainText(car.model || car.title.replace(/^\d{4}\s+/,''));
    await page.goto('/stock');
    await expect(page.getByRole('heading',{name:'Recently viewed',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>localStorage.getItem('luxxy.recent-vehicles.v1'))).toBeNull();
    await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);
    const slots=page.getByTestId('group-viewing-slots');
    await expect(slots).toBeVisible();
    await slots.getByRole('button').first().click();
    await page.getByTestId('button-continue-to-details').click();
    await expect(page.getByTestId('input-customer-name')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`/private/tmp/luxxy-practice-removed-booking-${width}.png`,fullPage:true});
    expect(practiceRequests).toEqual([]);
    expect(writes).toEqual([]);
  });
}
