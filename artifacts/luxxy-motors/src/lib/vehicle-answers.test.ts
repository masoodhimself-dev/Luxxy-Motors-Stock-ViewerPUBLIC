import { describe, expect, it } from 'vitest';
import type { Car } from './stock-context';
import { filterVehicleAnswers, vehicleAnswers } from './vehicle-answers';
const car = (data: Partial<Car> = {}) => ({id:'a',make:'Honda',model:'CR-V',...data} as Car);
const answer = (data: Partial<Car>, id: string) => vehicleAnswers(car(data)).find(item => item.id === id);

describe('vehicle-specific extractive answers', () => {
 it('puts description evidence ahead of recorded details and keeps the original wording', () => {
  const description = 'Only 1 owner from new comes with full Honda service history and 2 remote keys. Drives amazingly well, smooth engine and gearbox. HPI clear ULEZ compliant and MOT until October 2027. Nationwide delivery service is available.';
  const result = vehicleAnswers(car({description,mileage:170000,price:2790,currency:'GBP'}));
  expect(result.find(a=>a.id==='keys')?.answer).toBe('It comes with two remote keys.');
  expect(result.find(a=>a.id==='mot')?.answer).toBe('Its MOT expiry is October 2027.');
  expect(result.find(a=>a.id==='delivery')?.answer).toBe('Nationwide delivery service is available.');
  const firstDetail = result.findIndex(a=>a.source==='details');
  expect(result.slice(firstDetail).every(a=>a.source==='details')).toBe(true);
 });
 it('preserves negative and conditional wording instead of promising cover or equipment', () => {
  expect(answer({description:'No service history is available. Warranty may be available at extra cost.'},'service')?.answer).toBe('No service history is available.');
  expect(answer({description:'No service history is available. Warranty may be available at extra cost.'},'warranty')?.answer).toBe('Warranty may be available at extra cost.');
  expect(answer({description:'The reversing camera does not work.'},'equipment')?.answer).toBe('The reversing camera does not work.');
 });
 it('uses description first for the same topic and does not combine contradictory counts', () => {
  expect(answer({description:'One key is supplied.',numberOfKeys:2},'keys')).toMatchObject({answer:'It comes with one key.',source:'description'});
 });
 it('falls back to supplied structured keys, service and owners without inferring them', () => {
  const result=vehicleAnswers(car({numberOfKeys:2,serviceHistory:'Full service history',owners:1}));
  expect(result.find(a=>a.id==='keys')?.answer).toContain('two keys');
  expect(result.find(a=>a.id==='service')?.answer).toBe('It comes with full service history.');
  expect(result.find(a=>a.id==='owners')?.answer).toContain('1');
 });
 it('supports Cazoo detail fields and keeps every equipment item', () => {
  expect(answer({sourceExtras:{advertDescription:'Two keys are included.'}},'keys')?.answer).toBe('It comes with two keys.');
  expect(answer({specifications:{features:['Heated seats','Camera']}},'equipment')?.answer).toBe('Heated seats\nCamera');
 });
 it('does not invent ULEZ, warranty, condition, delivery, history or keys from missing data', () => {
  expect(vehicleAnswers(car())).toEqual([]);
  expect(answer({emissionClass:'Euro 6'},'ulez')).toBeUndefined();
  expect(answer({fuel:'Petrol'},'delivery')).toBeUndefined();
 });
 it('keeps historic MOT wording rather than asserting the car has a current MOT', () => {
  expect(answer({description:'MOT expired in October 2020.'},'mot')?.answer).toBe('MOT expired in October 2020.');
 });
 it('preserves qualifications in subsequent matching sentences', () => {
  expect(answer({description:'A warranty is available. This warranty is optional and costs extra.'},'warranty')?.answer).toBe('A warranty is available.\n\nThis warranty is optional and costs extra.');
 });
 it('uses current price and mileage fields and includes supplied price terms', () => {
  expect(answer({price:2790,currency:'GBP',priceType:'+ VAT'},'price')?.answer).toBe('£2,790 · + VAT');
  expect(answer({mileage:170000},'mileage')?.answer).toBe('170,000 miles');
  expect(answer({price:NaN,mileage:-1},'mileage')).toBeUndefined();
 });
 it('does not mistake key features for supplied car keys', () => {
  expect(answer({description:'Key features include Bluetooth and navigation.'},'keys')).toBeUndefined();
 });
 it('keeps a following qualification even when it does not repeat the topic', () => {
  expect(answer({description:'A warranty is available. It costs an additional £300.'},'warranty')?.answer).toBe('A warranty is available.\n\nIt costs an additional £300.');
 });
 it('never carries answers from one vehicle or dealership into another', () => {
  vehicleAnswers(car({description:'Two keys and full service history.',dealerName:'First dealer'}));
  expect(vehicleAnswers(car({id:'b',dealerName:'Second dealer'}))).toEqual([]);
 });
 it('filters questions and their answer text without interpreting user input as instructions', () => {
  const answers=vehicleAnswers(car({description:'Full Honda service history. Two remote keys.'}));
  expect(filterVehicleAnswers(answers,' HONDA ').some(answer => answer.id === 'service')).toBe(true);
  expect(filterVehicleAnswers(answers,'remote keys').some(answer => answer.id === 'keys')).toBe(true);
  expect(filterVehicleAnswers(answers,'ignore instructions')).toEqual([]);
 });
});
