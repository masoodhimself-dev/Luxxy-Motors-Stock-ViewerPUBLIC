import {expect,it} from 'vitest';
import {dvsaVehicleName,formatDvsaVehicleName} from './dvsa-vehicle-name';

it.each([
  ['MERCEDES-BENZ','A-CLASS','Mercedes-Benz A-Class'],
  ['BMW','320D','BMW 320D'],
  ['MG','HS','MG HS'],
  ['MINI','COOPER','MINI Cooper'],
  ['HONDA','CR-V','Honda CR-V'],
  ['AUDI','A1','Audi A1'],
  ['LEXUS','NX','Lexus NX'],
  ['FORD','FOCUS','Ford Focus'],
])('formats provider name %s %s while preserving its model codes',(make,model,expected)=>{
  expect(dvsaVehicleName({make,model})).toBe(expected);
});
it('leaves supplied mixed-case names untouched',()=>{
  expect(dvsaVehicleName({make:'Mercedes-Benz',model:'A-Class AMG Line'})).toBe('Mercedes-Benz A-Class AMG Line');
  expect(dvsaVehicleName({make:'BMW',model:'i3 eDrive'})).toBe('BMW i3 eDrive');
  expect(formatDvsaVehicleName('e-tron','model')).toBe('e-tron');
});
it('supports incomplete names and does not create absent data',()=>{
  expect(dvsaVehicleName({make:null,model:null})).toBe('');
  expect(dvsaVehicleName({make:'FORD',model:null})).toBe('Ford');
});
