import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createStockImportAdmission } from './lib/stock-import-admission';

function exchange(path = '/api/stock/imports/fictional/grok', method = 'POST') {
  const req = Object.assign(new EventEmitter(), { path, method });
  const res = Object.assign(new EventEmitter(), { destroyed: false, headers: {} as Record<string,string>, code: 200, body: undefined as unknown,
    set(headers: Record<string,string>) { Object.assign(this.headers, headers); return this; },
    status(code: number) { this.code = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  });
  return { req: req as any, res: res as any };
}

test('200 simultaneous uploads admit only two before parsing and return retryable backpressure', () => {
  const gate = createStockImportAdmission(2);
  let parsed = 0;
  const calls = Array.from({ length:200 }, () => exchange());
  for (const { req,res } of calls) gate.middleware(req,res,() => { parsed++; });
  assert.equal(parsed,2); assert.equal(gate.status().active,2);
  for (const {res} of calls.slice(2)) {
    assert.equal(res.code,503); assert.equal(res.headers['Retry-After'],'15');
    assert.equal(res.body.status,'busy'); assert.equal(res.body.runId,null);
  }
  calls[0].res.emit('finish'); calls[1].res.emit('close');
  assert.equal(gate.status().active,0);
  const retry=exchange(); gate.middleware(retry.req,retry.res,()=>{parsed++;});
  assert.equal(parsed,3); retry.res.emit('finish');
});

test('a disconnected running import holds its slot until its database operation finishes', async () => {
  const gate=createStockImportAdmission(1), call=exchange();
  gate.middleware(call.req,call.res,()=>{});
  let finish!:()=>void;
  const running=gate.run(call.req,call.res,()=>new Promise<void>(resolve=>{finish=resolve;}));
  call.res.destroyed=true; call.res.emit('close'); call.req.emit('aborted');
  assert.equal(gate.status().active,1);
  const second=exchange();gate.middleware(second.req,second.res,()=>assert.fail('Capacity must remain occupied'));
  assert.equal(second.res.code,503);
  finish();await running;assert.equal(gate.status().active,0);assert.equal(gate.status().completed,1);
});

test('body/auth failures and operation errors release exactly once; abandoned requests never import', async () => {
  const gate=createStockImportAdmission(1), malformed=exchange();
  gate.middleware(malformed.req,malformed.res,()=>{});malformed.res.emit('finish');malformed.res.emit('close');
  assert.equal(gate.status().completed,1);
  await gate.run(malformed.req,malformed.res,async()=>assert.fail('Closed request must not start an import'));
  const failed=exchange();gate.middleware(failed.req,failed.res,()=>{});
  await assert.rejects(gate.run(failed.req,failed.res,async()=>{throw new Error('Fictional database failure');}),/Fictional/);
  assert.equal(gate.status().active,0);assert.equal(gate.status().completed,2);
});

test('ordinary website, health and non-POST traffic never consumes import permits', () => {
  const gate=createStockImportAdmission(1);
  for(const [path,method] of [['/api/stock','GET'],['/api/readyz','GET'],['/api/stock/imports/fictional/grok','OPTIONS']]) {
    const call=exchange(path,method);let called=false;gate.middleware(call.req,call.res,()=>{called=true;});assert.equal(called,true);
  }
  assert.equal(gate.status().accepted,0);
});

test('import path matching follows Express case-insensitive routing', () => {
  const gate = createStockImportAdmission(1);
  const first = exchange('/API/STOCK/IMPORTS/fictional/grok');
  gate.middleware(first.req, first.res, () => {});
  const second = exchange('/api/stock/imports/fictional/grok');
  gate.middleware(second.req, second.res, () => assert.fail('Uppercase route must consume capacity'));
  assert.equal(second.res.code, 503);
  first.res.emit('finish');
});

test('concurrency configuration stays bounded and oldest active age is safe operational metadata', () => {
  let clock=100;const gate=createStockImportAdmission(4,()=>clock),call=exchange();
  gate.middleware(call.req,call.res,()=>{});clock=600;
  assert.equal(gate.status().oldestActiveMs,500);assert.equal(gate.status().maximum,4);
  for(const bad of [0,-1,5,NaN,1.5])assert.equal(createStockImportAdmission(bad).status().maximum,2);
});
