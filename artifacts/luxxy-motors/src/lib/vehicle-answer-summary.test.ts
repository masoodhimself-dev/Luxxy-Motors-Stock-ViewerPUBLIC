import { expect, it } from 'vitest';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { focusedVehicleAnswer, usableVehicleMotHistory, vehicleMotAnswer } from './vehicle-answer-summary';
import { vehicleAnswers } from './vehicle-answers';
const car = {id:'honda',make:'Honda',model:'CR-V',vrm:'PJ09YYM',description:'Only 1 owner from new comes with full Honda service history and 2 remote keys. Drives amazingly well, smooth engine and gearbox. HPI clear ULEZ compliant and MOT until October 2027.'} as Car;
const now = new Date('2026-10-31T12:00:00Z');
const history = {registration:'PJ09 YYM',checkedAt:now.toISOString(),make:'HONDA',model:'CR-V',recall:'Unknown',tests:[{completedDate:'2026-10-12',expiryDate:'2027-10-11',result:'PASSED',mileage:'170000',mileageUnit:'MI',defects:[]}]} as MotHistory;
it('composes a coherent car history without unrelated ULEZ or keys', () => {
 const result=vehicleAnswers(car);
 const summary=result.find(answer=>answer.id==='history')!.answer;
 expect(summary).toContain('It has had one owner from new.');
 expect(summary).toContain('It comes with full Honda service history.');
 expect(summary).toContain('Its MOT expiry is October 2027.');
 expect(summary).toContain('It drives well, with a smooth engine and gearbox.');
 expect(summary).not.toMatch(/ULEZ|keys|passed/i);
});
it('keeps MOT, insurance and ULEZ answers focused on their own subject', () => {
 const result=vehicleAnswers(car);
 expect(result.find(answer=>answer.id==='mot')!.answer).toBe('Its MOT expiry is October 2027.');
 expect(result.find(answer=>answer.id==='insurance')!.answer).toBe('It is HPI clear.');
 expect(result.find(answer=>answer.id==='ulez')!.answer).toBe('Yes, it is ULEZ compliant.');
});
it('distinguishes a single owner from new from a previous owner', () => {
 expect(focusedVehicleAnswer('owners','Only 1 owner from new.')).toBe('It has had one owner from new.');
 expect(focusedVehicleAnswer('owners','1 previous owner.')).toBe('It has had one previous owner.');
 expect(focusedVehicleAnswer('owners','2 previous keepers.')).toBe('It has had two previous keepers.');
});
it('keeps negatives and conditional promises instead of rewriting them positively', () => {
 for (const text of ['Not a one owner car.','Two keys can be supplied at extra cost.','It drives well when warm.','Full service history may be available.']) {
  const topic = text.includes('keys')?'keys':text.includes('drives')?'condition':text.includes('history')?'service':'owners';
  expect(focusedVehicleAnswer(topic,text)).toBe(text);
 }
});
it('does not fabricate a pass date from an expiry date', () => {
 expect(vehicleMotAnswer(car,null,now)).toBeNull();
 expect(vehicleAnswers(car).find(answer=>answer.id==='history')!.answer).not.toContain('passed');
});
it('uses the actual matching DVSA test date and expiry', () => {
 expect(vehicleMotAnswer(car,history,now)).toBe('It passed its latest recorded MOT on 12 October 2026. Its MOT expiry is 11 October 2027.');
});
it('rejects stale, future-checked or different-vehicle records', () => {
 expect(usableVehicleMotHistory(car,{...history,registration:'AB12CDE'},now)).toBe(false);
 expect(vehicleMotAnswer(car,{...history,checkedAt:'2026-10-20T12:00:00Z'},now)).toBeNull();
 expect(vehicleMotAnswer(car,{...history,checkedAt:'2026-11-01T12:00:00Z'},now)).toBeNull();
 expect(vehicleMotAnswer({...car,vrm:null} as Car,history,now)).toBeNull();
});
it('does not describe an older pass as the latest result after a failure', () => {
 const record={...history,tests:[...history.tests,{...history.tests[0],completedDate:'2026-10-25',result:'FAILED' as const,expiryDate:null}]};
 expect(vehicleMotAnswer(car,record,now)).toBe('Its latest recorded MOT result was a fail on 25 October 2026. Check the full MOT history for details.');
});
it('rejects impossible or future test dates', () => {
 expect(vehicleMotAnswer(car,{...history,tests:[{...history.tests[0],completedDate:'2026-11-05'}]},now)).toBeNull();
 expect(vehicleMotAnswer(car,{...history,tests:[{...history.tests[0],completedDate:'2026-02-30'}]},now)).toBeNull();
});
it('uses a supplied first MOT due date without inventing an exemption', () => {
 expect(vehicleMotAnswer(car,{...history,tests:[],firstMotDueDate:'2027-01-15'},now)).toBe('Its first MOT is due on 15 January 2027.');
 expect(vehicleMotAnswer(car,{...history,tests:[]},now)).toBeNull();
});

it('keeps equipment and condition answers separate in mixed descriptions', () => {
 expect(focusedVehicleAnswer('equipment','Very well maintained, heated leather seats, full panoramic roof, cruise control, reverse camera etc.')).toBe('It has heated leather seats, full panoramic roof, cruise control and reverse camera.');
 expect(focusedVehicleAnswer('condition','Excellent condition, heated seats and panoramic roof.')).toBe('Excellent condition.');
 expect(focusedVehicleAnswer('equipment','CarPlay preparation only.')).toBe('CarPlay preparation only.');
});
