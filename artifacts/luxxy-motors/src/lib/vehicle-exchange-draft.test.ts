import { beforeEach, expect, it, vi, afterEach } from 'vitest';
import { readVehicleExchange, saveVehicleExchange } from './vehicle-exchange-draft';
beforeEach(()=>sessionStorage.clear());
afterEach(()=>vi.restoreAllMocks());
it('keeps an exchange tied to the chosen stock vehicle and expires it',()=>{
  const now=Date.now(); vi.spyOn(Date,'now').mockReturnValue(now);
  expect(saveVehicleExchange('car-1',{registration:'AB12 CDE',mileage:'45000',notes:''})).toBe(true);
  expect(readVehicleExchange('car-1')).toEqual({registration:'AB12 CDE',mileage:'45000',notes:''});
  expect(readVehicleExchange('car-2')).toBeNull();
  vi.spyOn(Date,'now').mockReturnValue(now+31*60_000);
  expect(readVehicleExchange('car-1')).toBeNull();
  expect(sessionStorage.length).toBe(0);
});
it('ignores invalid storage and reports blocked browser storage',()=>{
  sessionStorage.setItem('luxxy.vehicle-exchange.car-1','{broken');
  expect(readVehicleExchange('car-1')).toBeNull();
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked')});
  expect(saveVehicleExchange('car-1',{registration:'AB12 CDE',mileage:'1',notes:''})).toBe(false);
});
