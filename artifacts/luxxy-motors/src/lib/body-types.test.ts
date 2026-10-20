import {expect,it} from 'vitest';
import type {Car} from './stock-context';
import {bodyTypeKey,stockBodyTypes} from './body-types';
it('groups supplied names across case, whitespace and accents without inventing missing types',()=>{
 const cars=['SUV',' suv ','Coupé','Coupe',null,'Unknown','N/A','Estate'].map(bodyType=>({bodyType}) as Car);
 expect(stockBodyTypes(cars)).toEqual([{label:'Coupé',count:2},{label:'SUV',count:2},{label:'Estate',count:1}]);
 expect(bodyTypeKey(' COUPÉ ')).toBe(bodyTypeKey('coupe'));expect(bodyTypeKey(null)).toBe('');
});
