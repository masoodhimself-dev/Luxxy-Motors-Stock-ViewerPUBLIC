import { expect, it } from 'vitest';
import { createVehicleQr } from './vehicle-sheet/qr';
import { validateVehiclePageUrl } from './vehicle-sheet/validation';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import autoFixture from './__fixtures__/vehicle-sheet-autotrader.json';
import cazooFixture from './__fixtures__/vehicle-sheet-cazoo.json';
it('encodes exact canonical vehicle UUID paths with a four-module quiet zone', () => {
 const readStock = (name:string,fixture:{id:string}) => process.env.VEHICLE_SHEET_PROOFS_DIR ? JSON.parse(readFileSync(join(process.env.VEHICLE_SHEET_PROOFS_DIR,`${name}-stock.json`),'utf8')) as {cars:{id:string}[]} : {cars:[fixture]};
 const auto=readStock('autotrader',autoFixture),cazoo=readStock('cazoo',cazooFixture);
 const rows=[];
 for(const [stock,origin] of [[auto,'https://luxxymotors.uk'],[cazoo,'https://multi-choice-motors-cazoo-test.demo.luxxyexmaplenumber2.uk']] as const){
  for(const car of stock.cars){
   const url = `${origin}/vehicle/${car.id}`;
   expect(validateVehiclePageUrl(url,{dealerWebsiteOrigin:origin,vehiclePathPrefix:'/vehicle/'})).toBe(url);
   const qr=createVehicleQr(url); expect(qr.payload).toBe(url);expect(qr.quietZone).toBe(4);expect(qr.sizeMm).toBeGreaterThanOrEqual(34);
   rows.push({id:car.id,url,svg:qr.svg});
  }
 }
 if(process.env.VEHICLE_SHEET_PROOFS_DIR){mkdirSync(process.env.VEHICLE_SHEET_PROOFS_DIR,{recursive:true});writeFileSync(join(process.env.VEHICLE_SHEET_PROOFS_DIR,'qr-proofs.json'),JSON.stringify(rows));}
});
