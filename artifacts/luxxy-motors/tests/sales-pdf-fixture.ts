import { expect, type Page } from "@playwright/test";
import { saleDocumentPdfBytes } from "../../../lib/vehicle-meta/src/sale-document-pdf";
import { randomUUID } from 'node:crypto';
import {
  changeSaleWorkspace, createSaleWorkspace, publicSaleWorkspace, SaleWorkspaceError,
  type SaleInvoiceVehicleReview, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDocument, type SaleWorkspaceRecord,
} from '@workspace/vehicle-meta';

export function fixtureInvoiceVehicleReview(
  sale: SaleWorkspaceRecord,
  checkedAt = new Date().toISOString(),
  expiryDate = new Date(Date.parse(checkedAt) + 180 * 86_400_000).toISOString().slice(0, 10),
): SaleInvoiceVehicleReview {
  return {
    id: randomUUID(), registration: sale.draft.registration, checkedAt, status: 'checked', warnings: [],
    dvla: { make: sale.draft.vehicle.split(' ')[0], colour: 'Blue', fuelType: 'Petrol', checkedAt },
    mot: { expiryDate, source: 'DVSA', checkedAt },
    lastMotMileage: { reading: 62114, unit: 'miles', recordedAt: '2026-08-31' },
    stockMileage: 64000,
  };
}

export function archivedPdf(document: SaleWorkspaceDocument) {
  return Buffer.from(saleDocumentPdfBytes(document));
}

/** Read the visible text, including glyphs in the embedded invoice fonts. */
export async function pdfText(pdf: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, useWorkerFetch: false });
  try {
    const document = await task.promise;
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const { items } = await page.getTextContent();
      lines.push(items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return lines.join(' ');
  } finally {
    await task.destroy();
  }
}

export function pdfPageCount(pdf: Buffer) {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
}

export function expectA4(pdf: Buffer) {
  const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Number(box[1])).toBeCloseTo(595, -1);
    expect(Number(box[2])).toBeCloseTo(842, -1);
  }
}

export async function saleStep(page: Page, name: "Deal details" | "Payments" | "Completion") {
  await page.getByRole("navigation", { name: "Sale sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

/** Guided sale operations run against one fixture record per browser test. */
export async function attachGuidedSale(page: Page, initial?: SaleWorkspaceRecord) {
  const state = { sale: initial, commands: [] as SaleWorkspaceCommand[], blockedWrites: [] as string[], pdfRequests: 0 };
  const context = (): SaleWorkspaceContext => ({
    now: new Date().toISOString(),
    actor: 'Fictional staff',
    actorId: 'fictional-vehicle-review-staff',
    nextId: randomUUID,
    nextNumber: kind => `GUIDED-${kind.toUpperCase()}-${randomUUID().slice(0, 8)}`,
    branding: {
      identity: { name: 'Fictional Motors', logoText: 'Fictional Motors', logoAsset: '' },
      contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' },
      legal: { companyName: '', companyNumber: '', vatNumber: '' },
    },
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const record = state.sale;
    try {
      if (path === '/api/sale-workspace') {
        if (method === 'GET') return route.fulfill({ json: { sales: record ? [publicSaleWorkspace(record)] : [], preview: true } });
        if (method === 'POST') {
          const result = createSaleWorkspace(request.postDataJSON(), context(), 'GUIDED-TEST-SALE');
          state.sale = result.sale;
          return route.fulfill({ status: 201, json: { ...result, sale: publicSaleWorkspace(result.sale), preview: true } });
        }
      }
      if (path === `/api/sale-operations/${record?.id}/calculation-check` && method === 'POST') {
        return route.fulfill({ json: { status: 'unavailable', message: 'The calculation provider is disabled for this fixture.' } });
      }
      if (record && path.startsWith(`/api/sale-workspace/${record.id}`)) {
        const suffix = path.slice(`/api/sale-workspace/${record.id}`.length);
        if (!suffix && method === 'GET') return route.fulfill({ json: { sale: publicSaleWorkspace(record), preview: true } });
        if (suffix === '/invoice-vehicle-review' && method === 'POST') {
          const details = context();
          expect(request.postDataJSON()).toEqual({ expectedRevision: record.revision });
          const review = fixtureInvoiceVehicleReview(record, details.now);
          record.invoiceVehicleReview = { review, revision: record.revision, actorId: details.actorId!, stockIdentity: '' };
          return route.fulfill({ json: { review } });
        }
        const pdf = suffix.match(/^\/documents\/([^/]+)\/pdf$/);
        if (pdf && method === 'GET') {
          const document = record.documents.find(row => row.id === pdf[1]);
          if (!document) return route.fulfill({ status: 404, json: { error: 'Fixture document not found.' } });
          state.pdfRequests++;
          return route.fulfill({ contentType: 'application/pdf', body: archivedPdf(document) });
        }
        let command: SaleWorkspaceCommand | undefined;
        if (!suffix && method === 'PUT') command = { action: 'update', draft: request.postDataJSON().draft };
        if (suffix === '/issue-invoice' && method === 'POST') {
          const { kind, acknowledge, vehicleReview } = request.postDataJSON();
          expect(vehicleReview).toEqual({ id: record.invoiceVehicleReview?.review.id, mileage: 64150, acknowledge: true });
          command = { action: 'issue-invoice', kind, acknowledge, vehicleReview };
        }
        if (command) {
          state.commands.push(command);
          const result = changeSaleWorkspace(record, command, request.postDataJSON(), context());
          state.sale = result.sale;
          return route.fulfill({ json: { ...result, sale: publicSaleWorkspace(result.sale), preview: true } });
        }
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
      state.blockedWrites.push(`${method} ${path}`);
      return route.abort('blockedbyclient');
    } catch (error) {
      if (!(error instanceof SaleWorkspaceError)) throw error;
      return route.fulfill({ status: error.status, json: { error: error.message } });
    }
  });
  return state;
}

export async function startGuidedSale(page: Page) {
  await page.goto('/portal?section=sales');
  await page.getByRole('button', { name: 'New sale', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a car', exact: true })).toBeVisible();
}

export async function chooseGuidedCar(page: Page, price?: string) {
  await page.getByRole('region', { name: 'Vehicle selection' }).getByRole('button', { name: /^Choose / }).first().click();
  if (price !== undefined) await page.getByLabel('Agreed vehicle price (£)', { exact: true }).fill(price);
  await page.getByRole('button', { name: 'Choose customer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose the customer', exact: true })).toBeVisible();
}

export async function finishGuidedSetup(page: Page) {
  await page.locator('.sale-desk-section-actions, .sales-flow-mobile-action').getByRole('button', { name: 'Choose what to do', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sale overview', exact: true })).toBeVisible();
}

export async function saveGuidedCustomer(page: Page, customer: string) {
  await page.getByLabel('Customer’s full name', { exact: true }).fill(customer);
  await page.getByLabel('Customer address', { exact: true }).fill('10 Fictional Road, London');
  await finishGuidedSetup(page);
}

export async function openInvoiceCompose(page: Page) {
  await page.locator('.sales-flow-menu').getByRole('button', { name: /^Create an invoice/ }).click();
  await expect(page.getByRole('heading', { name: 'Invoice details', exact: true })).toBeVisible();
}

export async function confirmInvoiceVehicle(page: Page) {
  await page.getByRole('button', { name: 'Check DVLA and MOT', exact: true }).click();
  const odometer = page.getByRole('textbox', { name: 'Current odometer (miles)', exact: true });
  await expect(odometer).toHaveValue('');
  await odometer.fill('64150');
  await page.getByRole('checkbox', { name: /confirmed the current odometer reading/ }).check();
}

export async function openSavedPaperwork(page: Page, document: SaleWorkspaceDocument) {
  await page.getByRole('button', { name: 'Payments and documents', exact: true }).click();
  const row = page.locator('.sale-desk-document-list > div').filter({ hasText: document.number });
  await row.getByRole('button', { name: 'View & share' }).click();
  await expect(page.getByRole('heading', { name: document.title, exact: true })).toBeVisible();
}

export async function openedPdf(page: Page) {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open & print invoice', exact: true }).click();
  const popup = await opened;
  await expect.poll(() => popup.url()).toMatch(/^blob:/);
  const bytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], popup.url());
  await popup.close();
  return Buffer.from(bytes);
}
