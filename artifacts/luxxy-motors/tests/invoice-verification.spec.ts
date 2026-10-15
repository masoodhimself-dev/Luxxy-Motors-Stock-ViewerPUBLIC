import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW!=='1','Isolated public invoice verification UI');
for(const width of [390,820,1440]) test(`invoice proof is readable and private at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/invoice-verification/**',route=>route.fulfill({json:{verified:true,number:'NF-INV-2026-00107',title:'Sales invoice',issuedAt:'2026-10-14T12:00:00Z',dealer:'Northfield Motors',vehicle:'Mercedes-Benz E-Class E220d AMG Line',registration:'AB20 XYZ',saleTotalPence:2450000,paymentsReceivedPence:1050000,balanceAtIssuePence:1400000,paymentCount:2,supersededBy:null}}));
  await page.goto('/verify-invoice/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/'+'a'.repeat(64));
  await expect(page.getByRole('heading',{name:'Invoice record found'})).toBeVisible();
  await expect(page.getByText('£14,000.00',{exact:true})).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('meta[name=robots]').getAttribute('content')).toBe('noindex, nofollow');
  await mkdir('output/ui-premium/invoice-verification',{recursive:true});
  await page.screenshot({path:`output/ui-premium/invoice-verification/proof-${width}.png`,fullPage:true});
});
