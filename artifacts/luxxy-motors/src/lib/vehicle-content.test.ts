import {expect,it} from 'vitest';
import type {Car} from './stock-context';
import {vehicleContent} from './vehicle-content';
it('maps Grok content and removes headings and duplicates',()=>{
 expect(vehicleContent({sourceExtras:{advertDescription:' Description ',featureList:['Please note:', 'Exterior','Bluetooth',' bluetooth ',null,'Added extras']}} as unknown as Car)).toEqual({description:'Description',features:['Bluetooth']});
});
it('does not invent missing content from section headings',()=>{
 expect(vehicleContent({sourceExtras:{featureList:['Valuable features','Rare features','Added extras']}} as unknown as Car)).toEqual({description:undefined,features:[]});
});
it('preserves dealer content and falls back from empty lists',()=>{
 expect(vehicleContent({description:'Dealer copy',features:[],sourceExtras:{advertDescription:'Imported',featureList:['Air conditioning']}} as unknown as Car)).toEqual({description:'Dealer copy',features:['Air conditioning']});
});
