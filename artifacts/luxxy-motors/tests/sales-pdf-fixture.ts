import { expect, type Page } from "@playwright/test";
import { saleDocumentPdfBytes } from "../../../lib/vehicle-meta/src/sale-document-pdf";
import type { SaleWorkspaceDocument } from "../../../lib/vehicle-meta/src/sale-workspace";

export function archivedPdf(document: SaleWorkspaceDocument) {
  return Buffer.from(saleDocumentPdfBytes(document));
}

/** Read the actual preview bytes, rather than trusting an independently rendered HTML copy. */
export async function previewPdf(page: Page) {
  await expect(page.locator('.sales-pdf-page[data-rendered="true"]').first()).toBeVisible();
  const href = await page.locator(".sales-pdf-document-meta").getByRole("link", { name: "Open PDF", exact: true }).getAttribute("href");
  const bytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url!)).arrayBuffer())], href);
  return Buffer.from(bytes);
}

/** jsPDF emits visible text in Tj operators; avoid matching PDF syntax such as `/FitH null`. */
export function pdfText(pdf: Buffer) {
  return [...pdf.toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
    .map(match => match[1].replace(/\\([\\()])/g, "$1")).join("\n");
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

export async function editView(page: Page) {
  const edit = page.getByRole("button", { name: "Edit sale", exact: true });
  if (await edit.isVisible()) await edit.click();
}

export async function previewView(page: Page) {
  const preview = page.getByRole("button", { name: "Invoice preview", exact: true });
  if (await preview.isVisible()) await preview.click();
}

export async function saleStep(page: Page, name: "Deal details" | "Payments" | "Completion") {
  await page.getByRole("navigation", { name: "Sale sections" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

export async function optionalPanel(page: Page, summary: string) {
  const panel = page.locator("details").filter({ has: page.locator("summary", { hasText: summary }) });
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
  return panel;
}
