import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { installVehicleSheetStyles, isMultiChoiceVehicleSheetUrl } from './styles';
import { multiChoiceSheetFontsCss } from './multi-choice-fonts';
import { VehicleSheetPage } from './view';
import type { SheetOptions, VehicleSheetData } from './types';

const data: VehicleSheetData = {
  dealer: { name: 'Dealer', accentColour: '#765432' },
  vehicle: { title: 'Toyota Corolla', registrationNumber: 'AB12 CDE', priceNote: 'Plus VAT', disclosures: ['Recorded insurance category supplied by the dealer.'] },
  document: { vehiclePageUrl: 'https://multichoicemotors.co.uk/vehicle/car-one' },
};
const options: SheetOptions = { dealerWebsiteOrigin: 'https://multichoicemotors.co.uk', vehiclePathPrefix: '/vehicle/', printAccentColour: '#654321' };

afterEach(() => document.body.replaceChildren());

describe('isolated vehicle-sheet website branding', () => {
  it.each(['https://multichoicemotors.co.uk/vehicle/car-one', 'https://www.multichoicemotors.co.uk/vehicle/car-one', 'https://MULTICHOICEMOTORS.CO.UK/vehicle/car-one'])('recognises the exact approved public hostname: %s', url => {
    expect(isMultiChoiceVehicleSheetUrl(url)).toBe(true);
  });

  it.each(['https://shoredrive.uk/vehicle/car-one', 'https://multichoicemotors.co.uk.other.example/vehicle/car-one', 'https://other.multichoicemotors.co.uk/vehicle/car-one', 'https://demo.multichoicemotors.co.uk/vehicle/car-one', 'http://multichoicemotors.co.uk/vehicle/car-one', 'https://multichoicemotors.co.uk:444/vehicle/car-one', 'https://user@multichoicemotors.co.uk/vehicle/car-one', 'not a URL'])('never selects this branding from a different, private or malformed origin: %s', url => {
    expect(isMultiChoiceVehicleSheetUrl(url)).toBe(false);
  });

  it('keeps other dealers on exactly the original stylesheet and installs no additional font faces', () => {
    const doc = document.implementation.createHTMLDocument();
    installVehicleSheetStyles(doc);
    const original = doc.querySelector('style[data-luxxy-vehicle-sheet]')!;
    const before = original.textContent;
    installVehicleSheetStyles(doc, { multiChoice: false });
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(doc.querySelector('[data-luxxy-vehicle-sheet-theme]')).toBeNull();
    expect(original.textContent === before).toBe(true);
    expect((before?.match(/@font-face/g) ?? []).length).toBe(3);
  });

  it('adds the brand stylesheet after the base once and removes it when a document is reused for another dealer', () => {
    const doc = document.implementation.createHTMLDocument();
    installVehicleSheetStyles(doc, { multiChoice: true });
    const base = doc.querySelector('style[data-luxxy-vehicle-sheet]')!;
    const brand = doc.querySelector('style[data-luxxy-vehicle-sheet-theme]')!;
    const before = base.textContent;
    expect(base.nextElementSibling).toBe(brand);
    installVehicleSheetStyles(doc, { multiChoice: true });
    expect(doc.querySelectorAll('style')).toHaveLength(2);
    expect(doc.querySelector('style[data-luxxy-vehicle-sheet-theme]')).toBe(brand);
    installVehicleSheetStyles(doc);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(base.textContent === before).toBe(true);
  });

  it('embeds the exact existing regular and bold WOFF2 subsets under the established font-loading alias', () => {
    const faces = [...multiChoiceSheetFontsCss.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
    expect(faces).toHaveLength(2);
    for (const [index, weight] of [400, 700].entries()) {
      const embedded = Buffer.from(faces[index][1], 'base64');
      const original = readFileSync(`public/brand/multi-choice-motors/fonts/montserrat-latin-${weight}.woff2`);
      expect(embedded.subarray(0, 4).toString()).toBe('wOF2');
      expect(embedded.equals(original)).toBe(true);
      expect(multiChoiceSheetFontsCss.includes(`font-weight:${weight}`)).toBe(true);
    }
    expect(multiChoiceSheetFontsCss.match(/font-family:LuxxySheetSans/g)).toHaveLength(2);
    expect(multiChoiceSheetFontsCss.includes('https:')).toBe(false);
    expect(multiChoiceSheetFontsCss.includes('LuxxySheetPlate')).toBe(false);
  });

  it('changes presentation without overriding custom print accents, plate fonts, A4 geometry or protected disclosure text', () => {
    const doc = document.implementation.createHTMLDocument();
    installVehicleSheetStyles(doc, { multiChoice: true });
    const css = doc.querySelector('style[data-luxxy-vehicle-sheet-theme]')!.textContent!;
    expect(css.includes('--lvs-ink:#192a36;--lvs-muted:#59656e;--lvs-line:#e1e5e8')).toBe(true);
    // Montserrat's taller price glyphs need a real line box, rather than a
    // clipping/overflow exception in the one-page fitting validator.
    expect(css.includes('.lvs-page h1{line-height:1.25}')).toBe(true);
    expect(css.includes('.lvs-price{line-height:1.3}')).toBe(true);
    expect(css.includes('.lvs-page:not(.lvs-mono) .lvs-included{background:#eef9fc}')).toBe(true);
    for (const unchanged of ['--lvs-accent:', '--lvs-accent-text:', 'LuxxySheetPlate', '@page']) expect(css.includes(unchanged)).toBe(false);
    expect(/(?:^|[;{}])\s*(?:width|height|padding|font-size|transform)\s*:/.test(css)).toBe(false);
    doc.body.innerHTML = renderToStaticMarkup(createElement(VehicleSheetPage, {
      data,
      assets: { photos: [], warnings: [], failedAssets: [] },
      plan: { spacing: 'normal', supportingPhotos: true, optionalFeatureLimit: 8, summary: 'normal' },
      qr: { svg: '<svg />', sizeMm: 35, modules: 29, quietZone: 4, payload: data.document.vehiclePageUrl },
      options: { ...options, monochrome: true },
    }));
    const page = doc.querySelector<HTMLElement>('.lvs-page')!;
    expect(page.classList.contains('lvs-mono')).toBe(true);
    expect(page.style.getPropertyValue('--lvs-accent')).toBe('#654321');
    expect(page.querySelector('.lvs-plate')?.textContent).toBe('AB12 CDE');
    expect(page.querySelector('.lvs-price-note[data-lvs-protected]')?.textContent).toBe('Plus VAT');
    expect(page.querySelector('.lvs-disclosures [data-lvs-protected] + p')?.textContent).toBe('Recorded insurance category supplied by the dealer.');
  });
});
