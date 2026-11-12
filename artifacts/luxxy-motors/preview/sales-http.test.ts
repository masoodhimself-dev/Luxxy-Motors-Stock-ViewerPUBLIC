import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PreviewSaleWorkspaceStore, salesPreview } from './sales';
import { previewStock } from './stock';
import { createSaleWorkspace, type SaleHandoffTaskPage, type SaleInvoiceVehicleReview, type SaleWorkspaceBranding, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';

const branding: SaleWorkspaceBranding = { identity: { name: 'HTTP Test Motors', logoText: '', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
const draft: SaleWorkspaceDraft = { id: 'http-draft', customer: 'HTTP test buyer', email: '', phone: '', address: '', vehicleId: '', vehicle: 'HTTP test car', registration: '', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false };

async function previewInvoiceApproval(origin: string, sale: SaleWorkspaceRecord) {
  const result = await fetch(`${origin}/api/sale-workspace/${sale.id}/invoice-vehicle-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ expectedRevision: sale.revision }),
  });
  assert.equal(result.status, 200);
  const { review } = await result.json() as { review: SaleInvoiceVehicleReview };
  assert.equal(review.status, 'unavailable');
  return { id: review.id, mileage: 22150, acknowledge: true };
}

test('Today preview cursor still finds the last task after an earlier linked draft reservation is cancelled', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-handoff-cursor-http-'));
  const filename = path.join(directory, 'sales.json');
  const store = new PreviewSaleWorkspaceStore(filename, async () => ({ branding }));
  const now = '2026-10-04T12:00:00.000Z';
  const sourceReservationId = randomUUID();
  const records = Array.from({length:101}, (_, index) => {
    const sale = createSaleWorkspace({draft:{...draft, ...(index === 0 ? {sourceReservationId} : {})}, requestId:randomUUID()},
      {now,actor:'Alex',nextId:randomUUID,nextNumber:randomUUID,branding}, `SALE-${index}`).sale;
    sale.id = `00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    sale.handoffTasks = [{id:randomUUID(),kind:'arrange-collection',status:'open',assigneeId:'preview-jamie',assigneeName:'Jamie',note:'Confirm a collection time.',
      createdAt:now,createdBy:'Alex',updatedAt:now,updatedBy:'Alex'}];
    return sale;
  });
  await writeFile(filename,JSON.stringify({schemaVersion:1,sales:records,numbers:{}}));
  const server = createServer((req,res) => {
    void salesPreview(req,res,new URL(req.url ?? '/',`http://${req.headers.host}`),store);
  });
  server.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const load = async (query?: URLSearchParams) => fetch(`${origin}/api/sale-workspace/handoff-tasks${query ? `?${query}` : ''}`,
    {headers:{'x-preview-staff-id':'preview-jamie'}});
  try {
    const response = await load();
    assert.equal(response.status,200);
    const first = await response.json() as SaleHandoffTaskPage;
    assert.equal(first.tasks.length,100);
    assert.equal(first.tasks[0]?.saleId,records[0]!.id);
    assert.ok(first.hasMore && first.nextCursor);
    assert.equal((await load(new URLSearchParams({cursor:'invalid'}))).status,400);
    assert.equal((await load(new URLSearchParams({cursor:first.nextCursor,offset:'1'}))).status,400);
    await store.releaseReservation(sourceReservationId);
    const released = await store.get(records[0]!.id);
    assert.equal(released.lifecycle?.status,'released');
    assert.equal(released.handoffTasks?.[0]?.resolutionReason,'sale-released');
    const next = await load(new URLSearchParams({cursor:first.nextCursor}));
    assert.equal(next.status,200);
    const last = await next.json() as SaleHandoffTaskPage;
    assert.deepEqual(last.tasks.map(task=>task.saleId),[records[100]!.id]);
    assert.equal(last.hasMore,false);
    assert.equal(last.nextCursor,undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(directory,{recursive:true,force:true});
  }
});

test('HTTP preview adapter shares a sale across requests, preserves receipt snapshots and enforces retry/revision/origin guards', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-sales-http-'));
  const store = new PreviewSaleWorkspaceStore(path.join(directory, 'sales.json'), async () => ({ branding }));
  const server = createServer((req, res) => {
    void salesPreview(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`), store).then(handled => {
      if (!handled) { res.statusCode = 404; res.end(); }
    }).catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); });
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async <T>(url: string, method = 'GET', body?: unknown, requestOrigin?: string) => {
    const response = await fetch(`${origin}${url}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(requestOrigin ? { Origin: requestOrigin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, data: await response.json() as T };
  };
  try {
    const createInput = { requestId: 'http-create-request', draft };
    const created = await request<SaleWorkspaceMutation>('/api/sale-workspace', 'POST', createInput, origin);
    assert.equal(created.status, 201); assert.equal(created.data.preview, true);
    const id = created.data.sale.id;
    const createRetry = await request<SaleWorkspaceMutation>('/api/sale-workspace', 'POST', createInput, origin);
    assert.equal(createRetry.status, 200); assert.equal(createRetry.data.sale.id, id); assert.equal(createRetry.data.replayed, true);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const depositInput = { expectedRevision: created.data.sale.revision, requestId: 'http-deposit-request', payment: { amount: '500', method: 'Cash', date, reference: 'Cash received', kind: 'deposit', status: 'confirmed' } };
    const deposit = await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/payments`, 'POST', depositInput, origin);
    assert.equal(deposit.status, 200); assert.equal(deposit.data.document?.title, 'Deposit receipt'); assert.equal(deposit.data.document?.balanceAtIssue, 1150000);
    const originalReceipt = JSON.stringify(deposit.data.document);
    const otherDevice = await request<{ sale: SaleWorkspaceRecord; preview: boolean }>(`/api/sale-workspace/${id}`);
    assert.equal(otherDevice.status, 200); assert.equal(otherDevice.data.sale.payments.length, 1); assert.equal(otherDevice.data.sale.revision, deposit.data.sale.revision);
    const paymentRetry = await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/payments`, 'POST', depositInput, origin);
    assert.equal(paymentRetry.data.replayed, true); assert.equal(paymentRetry.data.document?.id, deposit.data.document?.id);
    const staleSave = await request<{ error: string }>(`/api/sale-workspace/${id}`, 'PUT', { expectedRevision: created.data.sale.revision, requestId: 'http-stale-update', draft }, origin);
    assert.equal(staleSave.status, 409); assert.match(staleSave.data.error, /changed on another device/);
    const final = await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/payments`, 'POST', { expectedRevision: deposit.data.sale.revision, requestId: 'http-final-request', payment: { amount: '11500', method: 'Bank transfer', date, reference: 'Final balance', kind: 'final-payment', status: 'confirmed' } }, origin);
    assert.equal(final.status, 200); assert.equal(final.data.document?.balanceAtIssue, 0); assert.equal(final.data.document?.title, 'Final payment receipt');
    const reopened = await request<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${id}`);
    assert.equal(reopened.data.sale.payments.length, 2); assert.equal(JSON.stringify(reopened.data.sale.documents[0]), originalReceipt);
    const listed = await request<{ sales: SaleWorkspaceRecord[] }>('/api/sale-workspace');
    assert.equal(listed.data.sales.length, 1); assert.equal(listed.data.sales[0].id, id);
    const invoiceInput = { expectedRevision: reopened.data.sale.revision, requestId: 'verify-http-invoice', kind: 'full', acknowledge: true };
    const withoutVehicleCheck = await request<{ error: string }>(`/api/sale-workspace/${id}/issue-invoice`, 'POST', invoiceInput, origin);
    assert.equal(withoutVehicleCheck.status, 422);
    assert.match(withoutVehicleCheck.data.error, /vehicle details and odometer/);
    const vehicleReview = await previewInvoiceApproval(origin, reopened.data.sale);
    const invoice=await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/issue-invoice`,'POST',{...invoiceInput,vehicleReview},origin);
    assert.equal(invoice.status,200);
    const invoiceRetry=await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/issue-invoice`,'POST',{...invoiceInput,vehicleReview},origin);
    assert.equal(invoiceRetry.data.replayed,true);assert.equal(invoiceRetry.data.document!.verification!.url,invoice.data.document!.verification!.url);
    const verifyPath=new URL(invoice.data.document!.verification!.url).pathname.replace('/verify-invoice/','/api/invoice-verification/');
    const proofResponse=await fetch(origin+verifyPath);
    assert.equal(proofResponse.status,200);assert.equal(proofResponse.headers.get('referrer-policy'),'no-referrer');assert.equal(proofResponse.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(proofResponse.headers.get('cache-control'),'no-store');
    const proof=await proofResponse.json();assert.equal(proof.verified,true);assert.equal(proof.balanceAtIssuePence,0);assert.equal(proof.paymentCount,2);assert.equal(proof.customer,undefined);assert.equal(proof.payments,undefined);
    assert.equal(created.data.sale.team?.ownerName, 'Alex');
    const attention = await request<{ sales: Array<{ id: string; listAttention: string }> }>('/api/sale-workspace?queue=attention&owner=mine');
    assert.deepEqual(attention.data.sales.map(sale => [sale.id, sale.listAttention]), [[id, 'Deposit confirmation to send']]);
    const teamInput = { expectedRevision: invoice.data.sale.revision, requestId: 'http-team-assignment', ownerId: 'preview-jamie', note: 'Private handover note.' };
    const assignment = await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/team`, 'POST', teamInput, origin);
    assert.equal(assignment.status, 200); assert.equal(assignment.data.sale.team?.ownerName, 'Jamie');
    assert.equal(assignment.data.sale.team?.note, 'Private handover note.');
    const assignmentRetry = await request<SaleWorkspaceMutation>(`/api/sale-workspace/${id}/team`, 'POST', teamInput, origin);
    assert.equal(assignmentRetry.data.replayed, true);
    const queue = await request<{ sales: Array<{ listHasTeamNote: boolean; listOwnerName: string }> }>('/api/sale-workspace?queue=attention');
    assert.equal(queue.data.sales[0].listOwnerName, 'Jamie');
    assert.equal(queue.data.sales[0].listHasTeamNote, true);
    assert.doesNotMatch(JSON.stringify(queue.data), /Private handover note/);
    assert.equal((await request<{ sales: unknown[] }>('/api/sale-workspace?queue=attention&owner=mine')).data.sales.length, 0);
    const bad=await fetch(origin+verifyPath.slice(0,-1)+(verifyPath.endsWith('a')?'b':'a'));
    assert.equal(bad.status,404);
    const offOrigin = await request<{ error: string }>('/api/sale-workspace', 'POST', { requestId: 'http-cross-origin', draft }, 'https://unrelated.example');
    assert.equal(offOrigin.status, 403); assert.match(offOrigin.data.error, /authorised network/);
    const taskRoute = `/api/sale-workspace/${id}/handoff-tasks`;
    const assignees = await request<{members:{id:string}[]}>(taskRoute + '?kind=check-payment');
    assert.equal(assignees.status,200);
    assert.ok(assignees.data.members.some(member => member.id === 'preview-jamie'));
    const assignmentTask = { action:'assign', kind:'check-payment', assigneeId:'preview-jamie', note:'Preview payment task', requestId:randomUUID(), expectedRevision:assignment.data.sale.revision };
    const assignedTask = await request<SaleWorkspaceMutation>(taskRoute, 'POST', assignmentTask, origin);
    assert.equal(assignedTask.status,200);
    const task = assignedTask.data.sale.handoffTasks![0]!;
    assert.equal(task.status,'open');
    assert.equal((await request<SaleWorkspaceMutation>(taskRoute, 'POST', assignmentTask, origin)).data.replayed,true);
    const queueRequest = (staffId:string,query='') => fetch(`${origin}/api/sale-workspace/handoff-tasks${query}`, { headers:{'x-preview-staff-id':staffId} });
    const taskQueue = async (staffId:string,query='') => (await queueRequest(staffId,query)).json() as Promise<{tasks:Array<{saleId:string; task:{id:string}}>;hasMore:boolean}>;
    assert.deepEqual((await taskQueue('preview-alex')).tasks,[]);
    assert.deepEqual((await taskQueue('preview-jamie')).tasks.map(row=>[row.saleId,row.task.id]),[[id,task.id]]);
    assert.deepEqual(await taskQueue('preview-jamie','?offset=1'),{tasks:[],hasMore:false});
    assert.deepEqual(await taskQueue('preview-alex','?view=needs-reassignment'),{tasks:[],hasMore:false});
    assert.equal((await queueRequest('preview-jamie','?offset=-1')).status,400);
    assert.equal((await queueRequest('preview-jamie','?view=everyone')).status,400);
    const completeResponse = await fetch(origin + taskRoute, { method:'POST', headers:{'Content-Type':'application/json','x-preview-staff-id':'preview-jamie',Origin:origin}, body:JSON.stringify({ action:'complete', taskId:task.id, expectedRevision:assignedTask.data.sale.revision, requestId:randomUUID() }) });
    assert.equal(completeResponse.status,200);
    const completedTask = await completeResponse.json() as SaleWorkspaceMutation;
    assert.equal(completedTask.sale.handoffTasks![0]!.status,'completed');
    assert.deepEqual((await taskQueue('preview-jamie')).tasks,[]);
    assert.deepEqual(completedTask.sale.payments,assignedTask.data.sale.payments);
    assert.deepEqual(completedTask.sale.documents,assignedTask.data.sale.documents);
    assert.equal((await store.list()).length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('HTTP deposit and pending-confirm routes record received money with no reservation terms', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-deposit-http-'));
  const store = new PreviewSaleWorkspaceStore(path.join(directory, 'sales.json'), async () => ({ branding }));
  const fixtureCars = [false, true].map(() => ({ ...previewStock.cars[0], id: `http-deposit-${randomUUID()}`, sourceStatus: 'live' as const }));
  previewStock.cars.push(...fixtureCars);
  const server = createServer((req, res) => {
    void salesPreview(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`), store);
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (url: string, body: unknown) => {
    const response = await fetch(`${origin}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() as SaleWorkspaceMutation };
  };
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    for (const [index, confirmPending] of [false, true].entries()) {
      let sale = (await post('/api/sale-workspace', { requestId: randomUUID(), draft: { ...draft, vehicleId: fixtureCars[index].id } })).data.sale;
      const payment = { amount: '500.05', method: 'Cash', date, reference: 'Received at showroom', kind: 'deposit', status: 'confirmed' };
      if (confirmPending) {
        const pending = await post(`/api/sale-workspace/${sale.id}/payments`, { expectedRevision: sale.revision, requestId: randomUUID(), payment: { ...payment, status: 'pending' } });
        assert.equal(pending.status, 200);
        assert.equal(pending.data.sale.documents.length, 0);
        sale = pending.data.sale;
      }
      const endpoint = confirmPending ? `/api/sale-workspace/${sale.id}/payments/${sale.payments[0].id}/confirm` : `/api/sale-workspace/${sale.id}/take-deposit`;
      const body = { expectedRevision: sale.revision, requestId: randomUUID(), ...(confirmPending ? { reserveVehicle: true, date } : { payment }) };
      const reserved = await post(endpoint, body);
      assert.equal(reserved.status, 200);
      assert.equal(reserved.data.sale.lifecycle?.status, 'reserved');
      assert.equal(reserved.data.document?.paymentAmountPence, 50005);
      assert.equal(reserved.data.document?.balanceAtIssue, 1149995);
      assert.deepEqual(reserved.data.sale.documents.map(d => d.type), ['receipt', 'statement']);
      assert.deepEqual(reserved.data.sale.packDocumentIds, reserved.data.sale.documents.map(d => d.id));
      const archive = await fetch(`${origin}/api/sale-workspace/${sale.id}/documents/${reserved.data.document!.id}/pdf`);
      assert.equal(archive.status, 200);
      const frozen = Buffer.from(await archive.arrayBuffer());
      assert.equal(frozen.subarray(0, 5).toString(), '%PDF-');
      const retry = await post(endpoint, body);
      assert.equal(retry.status, 200);
      assert.equal(retry.data.replayed, true);
      assert.equal(retry.data.sale.payments.length, 1);
      assert.equal(retry.data.sale.documents.length, 2);
      const final = await post(`/api/sale-workspace/${sale.id}/payments`, { expectedRevision: reserved.data.sale.revision, requestId: randomUUID(), payment: { ...payment, amount: '11499.95', kind: 'final-payment' } });
      assert.equal(final.status, 200);
      assert.equal(final.data.document?.balanceAtIssue, 0);
      const attemptComplete = await post(`/api/sale-workspace/${sale.id}/complete-sale`, { expectedRevision: final.data.sale.revision, requestId: randomUUID(), acknowledge: true });
      assert.equal(attemptComplete.status, 422, 'Approved sale terms remain required at completion.');
      const reopened = await store.get(sale.id);
      assert.equal(reopened.payments.length, 2);
      assert.equal(reopened.documents.length, 3);
      assert.equal(reopened.lifecycle?.status, 'reserved');
      const after = await fetch(`${origin}/api/sale-workspace/${sale.id}/documents/${reserved.data.document!.id}/pdf`);
      assert.deepEqual(Buffer.from(await after.arrayBuffer()), frozen);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const car of fixtureCars) previewStock.cars.splice(previewStock.cars.findIndex(item => item.id === car.id), 1);
    await rm(directory, { recursive: true, force: true });
  }
});

test('guided invoice HTTP routes reserve on deposit, issue only two invoice kinds and remove stock only on explicit sold confirmation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guided-invoice-http-'));
  const car = { ...previewStock.cars[0], id: `guided-http-${randomUUID()}`, sourceStatus: 'live' as const };
  previewStock.cars.push(car);
  const store = new PreviewSaleWorkspaceStore(path.join(directory, 'sales.json'), async () => ({branding,vehicle:{id:car.id,title:'Test car',year:2020,mileage:22000}}));
  const server=createServer((req,res) => {void salesPreview(req,res,new URL(req.url ?? '/',`http://${req.headers.host}`),store);});
  server.listen(0,'127.0.0.1');await new Promise<void>((resolve,reject) => {server.once('listening',resolve);server.once('error',reject);});
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post=async (url:string,body:unknown) => {const response=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});return {status:response.status,data:await response.json() as SaleWorkspaceMutation};};
  try {
    let sale=(await post('/api/sale-workspace',{requestId:randomUUID(),draft:{...draft,vehicleId:car.id}})).data.sale;
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const payment={amount:'500',method:'Cash',date,reference:'DEP-HTTP',kind:'deposit',status:'confirmed'};
    const input={expectedRevision:sale.revision,requestId:randomUUID(),payment};
    const received=await post(`/api/sale-workspace/${sale.id}/invoice-payments`,input);assert.equal(received.status,200);sale=received.data.sale;assert.equal(sale.documents.length,0);assert.equal((await store.inventory())[car.id],'reserved');
    const repeated=await post(`/api/sale-workspace/${sale.id}/invoice-payments`,input);assert.equal(repeated.data.replayed,true);assert.equal(repeated.data.sale.payments.length,1);
    const deposit=await post(`/api/sale-workspace/${sale.id}/issue-invoice`,{expectedRevision:sale.revision,requestId:randomUUID(),kind:'deposit',acknowledge:true,vehicleReview:await previewInvoiceApproval(origin,sale)});assert.equal(deposit.status,200);sale=deposit.data.sale;assert.equal(deposit.data.document?.invoiceKind,'deposit');
    const paid=await post(`/api/sale-workspace/${sale.id}/invoice-payments`,{expectedRevision:sale.revision,requestId:randomUUID(),payment:{...payment,amount:'11500',kind:'final-payment',method:'Bank transfer'}});assert.equal(paid.status,200);sale=paid.data.sale;
    const full=await post(`/api/sale-workspace/${sale.id}/issue-invoice`,{expectedRevision:sale.revision,requestId:randomUUID(),kind:'full',acknowledge:true,vehicleReview:await previewInvoiceApproval(origin,sale)});assert.equal(full.status,200);sale=full.data.sale;assert.equal(sale.documents.length,2);assert.equal(sale.lifecycle?.status,'reserved');
    const pdf=await fetch(`${origin}/api/sale-workspace/${sale.id}/documents/${full.data.document!.id}/pdf`);assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type') ?? '',/application\/pdf/);assert.ok((await pdf.arrayBuffer()).byteLength>1000);
    const denied=await post(`/api/sale-workspace/${sale.id}/finish-invoice-sale`,{expectedRevision:sale.revision,requestId:randomUUID(),acknowledge:false});assert.equal(denied.status,422);assert.equal((await store.inventory())[car.id],'reserved');
    assert.equal(sale.checklists, undefined, 'Final reminders must not require saved attestations.');
    const sold=await post(`/api/sale-workspace/${sale.id}/finish-invoice-sale`,{expectedRevision:sale.revision,requestId:randomUUID(),acknowledge:true});assert.equal(sold.status,200);assert.equal((await store.inventory())[car.id],'sold');assert.equal(sold.data.sale.documents.length,2);
    const competing = await post('/api/sale-workspace', { requestId:randomUUID(), draft:{...draft,vehicleId:car.id,customer:'Another fixture buyer'} });
    assert.equal(competing.status, 201);
    const fetchSale = async (id:string) => (await fetch(`${origin}/api/sale-workspace/${id}`)).json() as Promise<{sale:SaleWorkspaceRecord}>;
    assert.equal((await fetchSale(sale.id)).sale.stockActionBlock, undefined);
    assert.equal((await fetchSale(competing.data.sale.id)).sale.stockActionBlock, 'another-sale');
  } finally {server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));previewStock.cars.splice(previewStock.cars.indexOf(car),1);await rm(directory,{recursive:true,force:true});}
});
