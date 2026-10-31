import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dealerConfig } from '@/config/dealer';
import type { Car } from './stock-context';
import { buildVehicleSheetData, vehicleSheetLocation } from './vehicle-sheet-data';
import { VehicleSheetPage, ellipsise, selectedFeatures, selectedRunningCosts } from './vehicle-sheet/view';
import { createVehicleQr } from './vehicle-sheet/qr';
import { validateData, validateVehiclePageUrl } from './vehicle-sheet/validation';
import type { MotHistory } from '@workspace/vehicle-meta';
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

const motCar = { id:'mot-car',title:'Ford Focus',vrm:'JD25KDW',images:[] } as unknown as Car;
const cachedHistory = (overrides: Partial<MotHistory> = {}): MotHistory => ({
  registration:'JD25 KDW',make:'FORD',model:'FOCUS',checkedAt:'2026-10-31T10:00:00Z',recall:'Unknown',
  tests:[{completedDate:'2026-10-20T09:00:00Z',result:'PASSED',expiryDate:'2027-10-19',mileage:'12000',mileageUnit:'MI',defects:[]}],
  ...overrides,
});
it('prints only a matching fresh cached MOT due date and its actual check date', () => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  try {
    const data=buildVehicleSheetData(motCar,dealerConfig,[],undefined,url,cachedHistory());
    expect(data.vehicle).toMatchObject({motSummary:'MOT until 19 Oct 2027',motCheckedDate:'31 Oct 2026'});
    expect(()=>validateData(data)).not.toThrow();
    for(const history of [cachedHistory({registration:'MA06LDW'}),cachedHistory({checkedAt:'2026-10-29T10:00:00Z'}),cachedHistory({checkedAt:'2026-10-31T13:00:00Z'})]) {
      expect(buildVehicleSheetData(motCar,dealerConfig,[],undefined,url,history).vehicle.motSummary).toBeUndefined();
    }
  } finally {vi.useRealTimers();}
});
it('uses the provider first MOT due date without guessing an exemption from the year', () => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  try {
    const data=buildVehicleSheetData(motCar,dealerConfig,[],undefined,url,cachedHistory({tests:[],firstMotDueDate:'2028-03-01'}));
    expect(data.vehicle.motSummary).toBe('First MOT due 1 Mar 2028');
    expect(buildVehicleSheetData({...motCar,year:2025},dealerConfig,[],undefined,url,cachedHistory({tests:[]})).vehicle.motSummary).toBeUndefined();
  } finally {vi.useRealTimers();}
});
it('does not promote an older pass, an expired MOT or an unverified source date', () => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  try {
    const history=cachedHistory();
    for(const tests of [
      [...history.tests,{...history.tests[0],completedDate:'2026-10-25T10:00:00Z',result:'FAILED' as const,expiryDate:null}],
      [{...history.tests[0],expiryDate:'2026-10-30'}],
      [{...history.tests[0],expiryDate:'2027-02-30'}],
      [{...history.tests[0],completedDate:'2026-10-31T13:00:00Z'}],
    ]) expect(buildVehicleSheetData(motCar,dealerConfig,[],undefined,url,cachedHistory({tests})).vehicle.motSummary).toBeUndefined();
    const sourceOnly=buildVehicleSheetData({...motCar,motExpiry:'2027-10-19'},dealerConfig,[],undefined,url);
    expect(sourceOnly.vehicle.motSummary).toBeUndefined();
    expect(sourceOnly.vehicle.historyFacts).not.toContainEqual(expect.objectContaining({label:'MOT expiry'}));
  } finally {vi.useRealTimers();}
});
it('includes only vehicle-specific warranty, service history and keys, keeping conditions in full', () => {
  const car={...motCar,warranty:'3 months included; claims limited to £500',serviceHistory:'Full service history',numberOfKeys:2};
  const data=buildVehicleSheetData(car,dealerConfig,[],undefined,url);
  expect(data.vehicle.includedSummary).toContain('3 months included; claims limited to £500');
  expect(data.vehicle.includedSummary).toMatch(/full service history/i);
  expect(data.vehicle.includedSummary).toMatch(/two keys/i);
  expect(data.vehicle.historyFacts).not.toContainEqual(expect.objectContaining({label:'Warranty'}));
  const output=renderToStaticMarkup(<VehicleSheetPage data={data} assets={{photos:[],warnings:[],failedAssets:[]}} plan={{spacing:'tight',supportingPhotos:false,optionalFeatureLimit:6,summary:'normal',summaryMaxChars:20}} qr={createVehicleQr(url)} options={{dealerWebsiteOrigin:'https://luxxymotors.uk'}}/>);
  expect(output).toContain('What’s included');expect(output).toContain('claims limited to £500');
  expect(buildVehicleSheetData(motCar,{...dealerConfig,warranty:{enabled:true,title:'Warranty',description:'All our cars have 12 months warranty',ctaLabel:'Details'}},[],undefined,url).vehicle.includedSummary).toBeUndefined();
});
it('keeps optional, extra-cost and conflicting inclusion claims out of the included block', () => {
  const car={...motCar,serviceHistory:'Full service history',numberOfKeys:2,warranty:'3 months',description:'No service history is supplied. Only one key is supplied. A warranty is available. It costs an additional £300.'};
  const data=buildVehicleSheetData(car,dealerConfig,[],undefined,url);
  expect(data.vehicle.includedSummary).not.toMatch(/warranty|full service history|two keys/i);
  expect(data.vehicle.includedSummary).toContain('one key');
  expect(data.vehicle.descriptionSummary).toContain('It costs an additional £300.');
  expect(data.vehicle.historyFacts).toContainEqual({label:'Warranty',value:'A warranty is available. It costs an additional £300.'});
});
it('limits optional highlights to eight while preserving every mandatory statement', () => {
  const data=buildVehicleSheetData(motCar,dealerConfig,[],undefined,url);
  data.vehicle.featureHighlights=[...Array.from({length:12},(_,index)=>`Feature ${index+1}`),{text:'A supplied material qualification',required:true}];
  const plan={spacing:'normal',supportingPhotos:true,optionalFeatureLimit:10,summary:'normal'} as const;
  expect(selectedFeatures(data,plan)).toHaveLength(9);
  expect(selectedFeatures(data,plan).at(-1)).toEqual({text:'A supplied material qualification',required:true});
});
it('retains material equipment conditions when optional features are shortened', () => {
  const data=buildVehicleSheetData({...motCar,features:['Bluetooth','Navigation','Heated seats','Air conditioning not working']},dealerConfig,[],undefined,url);
  expect(data.vehicle.disclosures).toContain('Air conditioning not working');
  const output=renderToStaticMarkup(<VehicleSheetPage data={data} assets={{photos:[],warnings:[],failedAssets:[]}} plan={{spacing:'tight',supportingPhotos:false,optionalFeatureLimit:2,summary:'normal'}} qr={createVehicleQr(url)} options={{dealerWebsiteOrigin:'https://luxxymotors.uk'}}/>);
  expect(output).toContain('Air conditioning not working');
});
it('prioritises three useful running costs without changing the full supplied data', () => {
  const data=buildVehicleSheetData(autoFixture as unknown as Car,dealerConfig,[],undefined,url);
  const fullCosts=data.vehicle.runningCosts;
  expect(selectedRunningCosts(data).map(row=>row.label)).toEqual(['Average','Tax per year','Insurance group']);
  expect(data.vehicle.runningCosts).toBe(fullCosts);expect(data.vehicle.runningCosts).toHaveLength(6);
});
it('preserves price and optional cost qualifications when the print summary is shortened', () => {
  const data=buildVehicleSheetData({...motCar,description:'Price excludes VAT. Additional charges apply.',sourceExtras:{runningCosts:{items:[{label:'Urban',value:'Estimated 51.4mpg; conditions apply'}]}}},dealerConfig,[],undefined,url);
  expect(data.vehicle.disclosures).toContain('Price excludes VAT.');
  expect(data.vehicle.disclosures).toContain('Additional charges apply.');
  expect(data.vehicle.disclosures).toContain('Urban: Estimated 51.4mpg; conditions apply');
});
it('keeps reserved availability while avoiding a duplicate available label or insurance category', () => {
  const available=buildVehicleSheetData({...motCar,inventoryStatus:'available',writeOffCategory:'N'},dealerConfig,[],undefined,url);
  expect(available.vehicle.historyFacts).not.toContainEqual({label:'Availability',value:'Available'});
  expect(available.vehicle.disclosures).toContain('Category N');
  const reserved=buildVehicleSheetData({...motCar,inventoryStatus:'reserved'},dealerConfig,[],undefined,url);
  expect(reserved.vehicle.historyFacts).toContainEqual({label:'Availability',value:'Reserved'});
});
it('prints supplied dealer viewing details and the exact vehicle QR in colour or monochrome', () => {
  const dealer={...dealerConfig,identity:{...dealerConfig.identity,name:'Multi-Choice Motors'},contact:{phone:'02046286488',email:'enquiries@multichoicemotors.co.uk'},address:{street:'36A Coldharbour Lane',city:'Hayes',postcode:'UB3 3EP'},hours:[{days:'Mon–Sat',times:'10am–6pm'},{days:'Sun',times:'10am–5pm'}]};
  const data=buildVehicleSheetData(motCar,dealer,[],undefined,url);
  for(const monochrome of [false,true]) {
    const output=renderToStaticMarkup(<VehicleSheetPage data={data} assets={{photos:[],warnings:[],failedAssets:[]}} plan={{spacing:'normal',supportingPhotos:false,optionalFeatureLimit:8,summary:'normal'}} qr={createVehicleQr(url)} options={{dealerWebsiteOrigin:'https://luxxymotors.uk',monochrome}}/>);
    expect(output).toContain('Multi-Choice Motors');expect(output).toContain('Arrange a viewing');expect(output).toContain('020 4628 6488');expect(output).toContain('UB3 3EP');expect(output).toContain('Mon–Sat 10am–6pm');expect(output).toContain('Sun 10am–5pm');expect(output).toContain(`href="${url}"`);
    expect(output.includes('lvs-mono')).toBe(monochrome);
  }
});
