import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createVehicleSheetImageHandler, permittedVehicleSheetImage } from './lib/vehicle-sheet-image';
import { isPublicImageAddress } from './lib/vehicle-brochure-images';
import { vehicleSheetImageRouter } from './routes/vehicle-sheet-image';
import { currentDealerId, runWithTenant } from './lib/tenant-context';
import { engine } from './test/tenant-test-db';

after(() => engine.close());
const id = '00000000-0000-4000-8000-000000000991';
const photo = 'https://m.atcdn.co.uk/a.jpg?width=640';
const cazoo = 'https://cdn.images.autoexposure.co.uk/AETA22820/AETV123_1.jpg?t=observed';
const vehicle = { id, heroImage: photo, images: [{ url: cazoo }] };
const png = () => {
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(640,16);bytes.writeUInt32BE(480,20);return bytes;
};

test('sheet image accepts only exact official HTTPS hosts without credentials, fragments, ports or private URLs', () => {
  assert.equal(permittedVehicleSheetImage(photo),true);assert.equal(permittedVehicleSheetImage(cazoo),true);
  for (const source of [undefined, [photo], `${photo} `, `${photo}#fragment`, 'http://m.atcdn.co.uk/a.jpg', 'https://m.atcdn.co.uk.evil.invalid/a.jpg', 'https://user:secret@m.atcdn.co.uk/a.jpg', 'https://m.atcdn.co.uk:444/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://images.otherdealer.uk/a.jpg', 'data:image/png;base64,AA', 'file:///etc/passwd']) assert.equal(permittedVehicleSheetImage(source),false,String(source));
  for(const address of ['127.0.0.1','169.254.169.254','10.0.0.1','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(isPublicImageAddress(address),false);
});

test('sheet image serves only an exact image of the current visible vehicle and rechecks cache membership', async () => {
  let current: typeof vehicle|null=vehicle, loads=0, finds=0;
  const serve=createVehicleSheetImageHandler({findVehicle:async requested=>{finds++;assert.equal(requested,id);return current;},loadPhotos:async photos=>{loads++;return photos.map(row=>({...row,bytes:png()}));}});
  for(const source of [photo,cazoo]) {
    const result=await serve('dealer-a',id,source);assert.equal(result.status,200);assert.equal(result.headers['Content-Type'],'image/png');assert.equal(result.headers['Cache-Control'],'private, max-age=30');assert.equal(result.headers['X-Content-Type-Options'],'nosniff');assert.equal(result.headers['Cross-Origin-Resource-Policy'],'same-origin');assert.deepEqual(result.body,png());
    assert.equal((await serve('dealer-a',id,source)).status,200);
  }
  assert.equal(loads,2);assert.equal(finds,4);
  assert.equal((await serve('dealer-a',id,'https://m.atcdn.co.uk/unrelated.jpg')).status,404);assert.equal(loads,2);
  assert.equal((await serve('dealer-a',id,photo.replace('640','641'))).status,404);
  current={...vehicle,heroImage:'https://m.atcdn.co.uk/replaced.jpg'};
  assert.equal((await serve('dealer-a',id,photo)).status,404,'an old cached image is not served after removal');
  current=null;assert.equal((await serve('dealer-a',id,cazoo)).status,404,'hidden/sold or another tenant vehicle is never served');
});

test('sheet image bytes are cached briefly and separately for each dealership', async () => {
  let clock=1000,loads=0;
  const serve=createVehicleSheetImageHandler({findVehicle:async()=>vehicle,now:()=>clock,loadPhotos:async photos=>{loads++;return photos.map(row=>({...row,bytes:png()}));}});
  await serve('dealer-a',id,photo);await serve('dealer-b',id,photo);await serve('dealer-a',id,photo);assert.equal(loads,2);
  clock+=5*60_000+1;await serve('dealer-a',id,photo);assert.equal(loads,3);
});

test('sheet image rejects oversize, non-raster, invalid dimensions, redirects and timeout failures without leaking details', async () => {
  for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),Buffer.alloc(2_000_001),Buffer.from('HTML error')]) {
    const serve=createVehicleSheetImageHandler({findVehicle:async()=>vehicle,loadPhotos:async photos=>photos.map(row=>({...row,bytes}))});
    const result=await serve('dealer-a',id,photo);assert.equal(result.status,503);assert.equal(result.headers['Cache-Control'],'no-store');
  }
  for(const message of ['Private image address','Redirect to 169.254.169.254','Image download timed out']) {
    const serve=createVehicleSheetImageHandler({findVehicle:async()=>vehicle,loadPhotos:async()=>{throw Error(message);}});
    const result=await serve('dealer-a',id,photo);assert.equal(result.status,503);assert.equal(String(result.body).includes(message),false);
  }
  const serve=createVehicleSheetImageHandler({findVehicle:async()=>{throw Error('database details');}});
  assert.equal((await serve('dealer-a','not-an-id',photo)).status,400);
  assert.equal((await serve('dealer-a',id,photo)).status,503);
});

test('sheet image bounds concurrent downloads and releases its capacity after errors', async () => {
  const release: Array<()=>void>=[];
  const serve=createVehicleSheetImageHandler({findVehicle:async()=>vehicle,loadPhotos:async()=>{await new Promise<void>(resolve=>release.push(resolve));throw Error('offline');}});
  const active=Array.from({length:3},()=>serve('dealer-a',id,photo));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await serve('dealer-a',id,photo)).status,503);assert.equal(release.length,3);
  release.splice(0).forEach(resolve=>resolve());await Promise.all(active);
  const next=serve('dealer-a',id,photo);await new Promise(resolve=>setImmediate(resolve));assert.equal(release.length,1);release[0]();assert.equal((await next).status,503);
});

test('read-only route binds current tenant and isolates visitor quotas without any stock writes', async () => {
  const previous=process.env.RENDER;process.env.RENDER='true';let loads=0;
  const app=express();
  app.use((req,_res,next)=>runWithTenant({dealerId:req.get('x-fixture-dealer')==='b'?'dealer-b':'dealer-a',canonicalOrigin:'https://example.test',platform:'cazoo',retailerId:'fixture',sourceUrl:'https://example.test'},next));
  app.use('/api',vehicleSheetImageRouter(async requested=>currentDealerId()==='dealer-a'&&requested===id?vehicle as any:null,async photos=>{loads++;return photos.map(row=>({...row,bytes:png()}));}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/vehicles/${id}/sheet-image?source=${encodeURIComponent(photo)}`;
  const call=(dealer='a',ip='203.0.113.1',method='GET')=>fetch(base,{method,headers:{'x-fixture-dealer':dealer,'cf-connecting-ip':ip}});
  try {
    assert.equal((await call('b')).status,404);assert.equal(loads,0);
    for(let i=0;i<30;i++) assert.equal((await call()).status,200);
    assert.equal(loads,1);const limited=await call();assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
    assert.equal((await call('a','203.0.113.2')).status,200);
    assert.equal((await call('a','203.0.113.2','POST')).status,404);
  } finally {
    if(previous===undefined)delete process.env.RENDER;else process.env.RENDER=previous;
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
