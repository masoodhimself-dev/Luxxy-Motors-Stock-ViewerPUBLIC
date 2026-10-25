import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dealerConfig } from '@/config/dealer';
import type { Car } from './stock-context';
import { buildVehicleSheetData, vehicleSheetLocation } from './vehicle-sheet-data';
import { VehicleSheetPage, ellipsise } from './vehicle-sheet/view';
import { createVehicleQr } from './vehicle-sheet/qr';
import { validateVehiclePageUrl } from './vehicle-sheet/validation';
import autoFixture from './__fixtures__/vehicle-sheet-autotrader.json';
import cazooFixture from './__fixtures__/vehicle-sheet-cazoo.json';
const url = 'https://luxxymotors.uk/vehicle/actual-id';
it.each([['Auto Trader', autoFixture as unknown as Car], ['Cazoo', cazooFixture as unknown as Car]])('maps real %s data without guessing absent plates', (_source, car) => {
  const data = buildVehicleSheetData(car, dealerConfig, [], undefined, url);
  expect(data.vehicle.title).toBeTruthy(); expect(data.vehicle.photos?.length).toBeGreaterThan(0);
  expect(data.vehicle.descriptionSummary).toBeTruthy();
  expect(data.document.vehiclePageUrl).toBe(url);
  if (_source === 'Cazoo') { expect(data.vehicle.registrationNumber).toBeUndefined(); expect(data.vehicle.bodyType).toBe('Saloon'); expect(data.vehicle.featureHighlights).toHaveLength(62); expect(data.vehicle.runningCosts?.some(row => row.value.includes('200'))).toBe(true); }
});
it('keeps complete material statements outside a shortened optional description', () => {
  const car = { id:'x', title:'Ford Focus', writeOffCategory:'S', description: `A lovely car. ${'Comfortable everyday driving. '.repeat(80)}Air conditioning is not working. This car has repaired accident damage. Known scratch on the rear door.`, images:[] } as unknown as Car;
  const data = buildVehicleSheetData(car, dealerConfig, [], undefined, url);
  const output = renderToStaticMarkup(<VehicleSheetPage data={data} assets={{photos:[],warnings:[],failedAssets:[]}} plan={{spacing:'tight',supportingPhotos:false,optionalFeatureLimit:2,summary:'normal',summaryMaxChars:60}} qr={createVehicleQr(url)} options={{dealerWebsiteOrigin:'https://luxxymotors.uk'}} />);
  expect(output).toContain('…'); expect(output).toContain('Air conditioning is not working.'); expect(output).toContain('repaired accident damage.'); expect(output).toContain('Known scratch on the rear door.'); expect(output).toContain('Category S');
});
it('chooses the actual gearbox glyph and shows ellipses for omitted highlights', () => {
  for (const transmission of ['Manual','Automatic','Unknown']) {
    const data = buildVehicleSheetData({id:'x',title:'Ford',transmission,features:['One','Two','Three'],images:[]} as unknown as Car, dealerConfig,[],undefined,url);
    const output = renderToStaticMarkup(<VehicleSheetPage data={data} assets={{photos:[],warnings:[],failedAssets:[]}} plan={{spacing:'tight',supportingPhotos:false,optionalFeatureLimit:2,summary:'normal'}} qr={createVehicleQr(url)} options={{dealerWebsiteOrigin:'https://luxxymotors.uk'}} />);
    expect(output).toContain('… Full equipment list online.');
    if(transmission==='Manual')expect(output).toContain('data-dealer-icon="transmission-manual"');
    else expect(output).not.toContain('data-dealer-icon="transmission-manual"');
  }
  expect(ellipsise('A very long description',12)).toBe('A very…');
});
it('rejects local, marketplace, different dealer and temporary QR destinations', () => {
  for (const destination of ['http://localhost:4212/vehicle/x','https://cazoo.co.uk/vehicle/x','https://otherdealer.uk/vehicle/x','https://luxxymotors.uk/vehicle/x?token=secret']) expect(() => validateVehiclePageUrl(destination,{dealerWebsiteOrigin:'https://luxxymotors.uk',vehiclePathPrefix:'/vehicle/'})).toThrow();
  expect(vehicleSheetLocation('actual-id', {querySelector:()=>({content:'https://luxxymotors.uk'}),location:{origin:'http://localhost:4212'}} as unknown as Document).url).toBe(url);
});
