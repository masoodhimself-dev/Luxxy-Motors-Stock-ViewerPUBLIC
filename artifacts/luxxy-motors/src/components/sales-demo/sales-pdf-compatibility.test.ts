import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { saleDocumentPdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import { saleWorkspaceBranding, saleWorkspaceTotals, type SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { dealerConfig } from '@/config/dealer';
import { emptyDraft } from './model';

it('parses the real invoice with the supported reader when recent browser APIs are absent', () => {
  const draft = { ...emptyDraft(), id: 'TEST-SALE-1', customer: 'Alex Example', vehicle: 'Ford Focus', registration: 'AB20 XYZ', vin: 'WBA12345678901234', price: '10000', deliveryCharge: '120' };
  const document: SaleWorkspaceDocument = {
    id: 'test-document', number: 'TEST ONLY / INV-1', type: 'invoice', title: 'Sales invoice',
    templateVersion: 'sales-workspace-v2', issuedAt: '2026-11-04T12:00:00Z', issuedBy: 'Practice staff',
    version: 1, balanceAtIssue: 1012000,
    snapshot: { draft, payments: [], totals: saleWorkspaceTotals(draft), branding: saleWorkspaceBranding(dealerConfig) },
  };
  const bytes = saleDocumentPdfBytes(document, { draft: true });
  const require = createRequire(import.meta.url);
  const reader = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  // Isolate the real package and worker from jsdom and the reader mocks in UI
  // tests. This reproduces the embedded-browser failure without opening a PDF,
  // using a customer URL, or relying on whichever new APIs Node happens to have.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    delete Uint8Array.prototype.toHex;
    delete Uint8Array.fromHex;
    delete Map.prototype.getOrInsertComputed;
    const reader = await import(process.argv[1]);
    const task = reader.getDocument({ data: Uint8Array.from(Buffer.from(process.argv[2], 'base64')), useSystemFonts: true, useWorkerFetch: false });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const operators = await page.getOperatorList();
      const text = (await page.getTextContent()).items.map(item => item.str ?? '').join(' ');
      console.log(JSON.stringify({ pages: pdf.numPages, width: page.getViewport({scale: 1}).width, operators: operators.fnArray.length, text }));
    } finally { await task.destroy(); }
  `, reader, Buffer.from(bytes).toString('base64')], { encoding: 'utf8', timeout: 15000 });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  expect(output.pages).toBeGreaterThan(0);
  expect(output.width).toBeGreaterThan(500);
  expect(output.operators).toBeGreaterThan(0);
  expect(output.text).toContain('Alex Example');
  expect(output.text).toContain('TEST ONLY');
  expect(output.text).toContain('10,120.00');
  expect(output.text).toContain(draft.vin);
});
