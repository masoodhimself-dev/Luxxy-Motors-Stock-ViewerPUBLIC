import {expect, test} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixtures only');
for (const width of [320,390,1440]) test(`vehicle redesign at ${width}`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  await page.goto('/vehicle/preview-2');
  await expect(page.getByRole('heading', {name:'MG HS', exact:true})).toBeVisible();
  await expect(page.locator('.vehicle-summary')).toContainText('£13,255');
  await expect(page.locator('.vehicle-summary')).not.toContainText(/monthly|finance/i);
  await expect(page.getByTestId('button-print-vehicle')).toBeVisible();
  await page.getByRole('button',{name:'Next photograph',exact:true}).click();
  await expect(page.getByRole('button',{name:/Show photograph 2 of/})).toHaveAttribute('aria-current','true');
  await page.getByRole('button',{name:'View gallery fullscreen'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'Enquire about this car',exact:true}).click();
  await page.getByTestId('input-customer-name').fill('Preview Customer');
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Preview Customer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo({top:0,behavior:'instant'}); });
  await mkdir('../../docs/screenshots/vehicle-redesign',{recursive:true});
  await page.locator('.vehicle-inline-enquiry').screenshot({path:`../../docs/screenshots/vehicle-redesign/enquiry-${width}.png`, animations:'disabled'});
  await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:`../../docs/screenshots/vehicle-redesign/vehicle-${width}.png`, animations:'disabled'});
});

test('inline enquiry keeps the selected car and submits through the existing contract', async ({page}) => {
  let enquiry: Record<string,unknown> | undefined;
  await page.route('**/api/enquiries', async route => {
    enquiry = route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reference:'LOCAL-UI-CHECK',message:'Enquiry received'})});
  });
  await page.goto('/vehicle/preview-2');
  await page.getByTestId('input-customer-name').fill('Preview Customer');
  await page.getByTestId('input-customer-email').fill('preview@example.com');
  await page.getByTestId('textarea-enquiry-message').fill('Please tell me more about the service history.');
  await page.getByTestId('button-submit-enquiry').click();
  await expect.poll(() => enquiry?.vehicleId).toBe('preview-2');
  expect(enquiry?.type).toBe('general');
});
