import { it, expect } from 'vitest';
import { parseStockSearch } from './natural-stock-search';
import type { Car } from './stock-context';
const cars = [{make:'BMW',fuel:'Petrol',transmission:'Automatic'}] as Car[];
it('recognises supported terms and retains unknown search text',()=>{
 expect(parseStockSearch('automatic under £15k',cars)).toEqual({transmission:'Automatic',maxPrice:'15000',search:''});
 expect(parseStockSearch('BMW petrol',cars)).toEqual({make:'BMW',fuel:'Petrol',search:''});
 expect(parseStockSearch('AB12 BMW',cars)).toEqual({make:'BMW',search:'ab12'});
 expect(parseStockSearch('blue coupe',cars).search).toBe('blue coupe');
});
