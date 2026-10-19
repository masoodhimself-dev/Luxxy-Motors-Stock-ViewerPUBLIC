import {expect,it} from 'vitest';
import type {Car} from './stock-context';
import {prioritiseVehicleFeatures, vehicleContent, vehicleDescriptionParagraphs} from './vehicle-content';
it('maps Grok content and removes headings and duplicates',()=>{
 expect(vehicleContent({sourceExtras:{advertDescription:' Description ',featureList:['Please note:', 'Exterior','Bluetooth',' bluetooth ',null,'Added extras']}} as unknown as Car)).toEqual({description:'Description',features:['Bluetooth']});
});
it('does not invent missing content from section headings',()=>{
 expect(vehicleContent({sourceExtras:{featureList:['Valuable features','Rare features','Added extras']}} as unknown as Car)).toEqual({description:undefined,features:[]});
});
it('preserves dealer content and falls back from empty lists',()=>{
 expect(vehicleContent({description:'Dealer copy',features:[],sourceExtras:{advertDescription:'Imported',featureList:['Air conditioning']}} as unknown as Car)).toEqual({description:'Dealer copy',features:['Air conditioning']});
});

it('puts practical supplied equipment first and keeps source order within each group', () => {
 const features = ['Chrome door handles', 'ISOFIX child-seat mounts', 'Bluetooth audio', 'Satellite Navigation', 'Heated Front Seats', 'Dual-zone Climate Control', 'Adaptive Cruise Control', 'Rear Parking Sensors', 'Reversing Camera', 'Android Auto', 'Apple CarPlay', 'Alloy wheels'];
 expect(prioritiseVehicleFeatures(features)).toEqual(['Android Auto', 'Apple CarPlay', 'Rear Parking Sensors', 'Reversing Camera', 'Adaptive Cruise Control', 'Heated Front Seats', 'Dual-zone Climate Control', 'Bluetooth audio', 'Satellite Navigation', 'ISOFIX child-seat mounts', 'Chrome door handles', 'Alloy wheels']);
});

it('retains exact text, duplicates and all entries without mutating the input', () => {
 const features = [' Alloy wheels ', 'Apple CarPlay™', 'Apple CarPlay™', 'Unknown supplied equipment'];
 const original = [...features];
 Object.freeze(features);
 const prioritised = prioritiseVehicleFeatures(features);
 expect(prioritised).toEqual(['Apple CarPlay™', 'Apple CarPlay™', ' Alloy wheels ', 'Unknown supplied equipment']);
 expect(features).toEqual(original);
 expect(prioritised).not.toBe(features);
});

it('never promotes equipment described as missing, unavailable or removed', () => {
 const features = ['No parking sensors', 'Without Apple CarPlay', 'Navigation not fitted', 'Heated seats removed', 'Bluetooth unavailable', 'ISOFIX absent', 'Cruise control deleted', 'Reversing camera missing', 'Cruise control isn’t fitted', 'Android Auto doesn’t work', 'Non-functioning parking sensors', 'Faulty climate control', 'Alloy wheels', 'Bluetooth telephone'];
 expect(prioritiseVehicleFeatures(features)).toEqual(['Bluetooth telephone', ...features.slice(0, -1)]);
});

it('recognises common supplied camera and navigation labels without inventing features', () => {
 expect(prioritiseVehicleFeatures(['Body-coloured bumpers', 'Sat-Nav', 'Rear-View Camera', '360° Camera', 'Air Conditioning'])).toEqual(['Rear-View Camera', '360° Camera', 'Air Conditioning', 'Sat-Nav', 'Body-coloured bumpers']);
 expect(prioritiseVehicleFeatures([])).toEqual([]);
});

it('keeps vehicleContent in original source order until a caller requests prioritisation', () => {
 const features = ['Alloy wheels', 'Bluetooth', 'Apple CarPlay'];
 expect(vehicleContent({ features } as unknown as Car).features).toEqual(features);
 expect(prioritiseVehicleFeatures(vehicleContent({ features } as unknown as Car).features)).toEqual(['Apple CarPlay', 'Bluetooth', 'Alloy wheels']);
});

it('breaks long descriptions into paragraphs without losing the seller’s history disclosure', () => {
 const first = 'This is the seller’s original description with supplied details and punctuation. '.repeat(6).trim();
 const disclosure = 'Car is recorded as Cat S. Ask us for the available records.';
 const description = `${first} ${disclosure}`;
 const paragraphs = vehicleDescriptionParagraphs(description);
 expect(paragraphs.length).toBeGreaterThan(1);
 expect(paragraphs.join(' ')).toBe(description);
 expect(paragraphs.join(' ')).toContain(disclosure);
});

it('keeps supplied paragraph breaks, line breaks, prices and decimals intact', () => {
 expect(vehicleDescriptionParagraphs('Engine: 1.6L\nPrice: £7,995.50\n\nViewing by appointment.')).toEqual(['Engine: 1.6L\nPrice: £7,995.50', 'Viewing by appointment.']);
 expect(vehicleDescriptionParagraphs('')).toEqual([]);
});
