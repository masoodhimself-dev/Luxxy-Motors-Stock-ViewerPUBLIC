import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { defaultInvoiceSettings } from '@workspace/vehicle-meta';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated settings UI; every write intercepted');
for (const width of [390, 820, 1440]) test(`invoice settings and live design at ${width}`, async ({ page }) => {
 await page.setViewportSize({ width, height: 1000 });
 let settings = { revision: 1, saleTerms: '', reservationTerms: '', invoiceSettings: { ...defaultInvoiceSettings } };
 let writes = 0; const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('**/api/**', async route => {
  if (new URL(route.request().url()).pathname === '/api/dealer-integrations/sales-paperwork') {
   if (route.request().method() === 'PUT') { const body=route.request().postDataJSON(); expect(body.invoiceSettings.referencePrefix).toBe('LUX');expect(body.invoiceSettings.startingSequence).toBe(120);settings={...body,revision:2};writes++; }
   return route.fulfill({json:settings});
  }
  if (!['GET','HEAD'].includes(route.request().method())) return route.abort();
  return route.continue();
 });
 await page.goto('/portal?section=settings');
 await page.getByRole('navigation',{name:'Dealership settings',exact:true}).getByRole('button',{name:'Sales documents',exact:true}).click();
 await page.getByLabel('Dealer reference prefix').fill('lux');
 await page.getByLabel('Starting sequence (minimum)').fill('120');
 await page.getByLabel('Design style').selectOption('premium');
 await page.getByLabel('Use website colour').uncheck();
 await page.getByLabel('Thank-you / footer wording').fill('Thank you for choosing our dealership.');
 await page.getByLabel('Payment instructions').fill('Contact the showroom to confirm payment details.');
 const preview=page.locator('.invoice-settings-preview .invoice-sheet');
 await expect(preview).toHaveAttribute('data-design','premium');
 await expect(preview).toContainText('Thank you for choosing our dealership.');
 await expect(page.getByText('LUX-INV-2026-00120',{exact:true})).toBeVisible();
 await page.getByLabel('Show dealership logo').uncheck();
 await expect(preview.locator('.invoice-logo,.invoice-wordmark')).toHaveCount(0);
 await page.getByRole('button',{name:'Save document settings',exact:true}).click();
 await expect(page.getByText('Document settings saved. Existing issued documents keep their original design, reference and terms.',{exact:true})).toBeVisible();
 expect(writes).toBe(1); expect(errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await mkdir('output/ui-premium/invoice-settings',{recursive:true});
 await page.screenshot({path:`output/ui-premium/invoice-settings/settings-${width}.png`,fullPage:true});
 if(width===1440){await page.emulateMedia({media:'print'});await page.evaluate(()=>{document.body.innerHTML=document.querySelector('.invoice-settings-preview .invoice-sheet')!.outerHTML;document.body.firstElementChild!.classList.add('sales-print-copy');});await page.pdf({path:'../../output/pdf/invoice-settings-example.pdf',format:'A4',printBackground:true});}
});
