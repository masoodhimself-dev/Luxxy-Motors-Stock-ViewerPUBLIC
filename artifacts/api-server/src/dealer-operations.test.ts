import assert from 'node:assert/strict';
import test from 'node:test';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { dealerOperationsSummary, paymentLedgerCsv, stockHealth } from './lib/dealer-operations';
import { operationPermission, permissionsForRole, roleHasPermission } from './lib/staff-permissions';
import { expectedSettingsRevision, nextSettingsVersion, PostgresSettingsVersionStore, SettingsVersionError, type SettingsVersion } from './lib/settings-versions';
const current: SettingsVersion = { revision: 4, config: { identity: { name: 'Dealer' } }, publishedAt: '2026-10-01T12:00:00Z', publishedBy: 'Owner', action: 'publish' };
test('role grants and route checks protect money, publication, team and advertised prices', () => {
  assert.equal(roleHasPermission('owner','integrations.manage'),true);
  assert.equal(roleHasPermission('salesperson','payments.refund'),false);
  assert.equal(roleHasPermission('salesperson','settings.publish'),false);
  assert.equal(roleHasPermission('accounts','finance.export'),true);
  assert.equal(roleHasPermission('accounts','sales.manage'),false);
  assert.equal(permissionsForRole('owner').includes('stock.manage'),true);
  assert.equal(operationPermission('POST','/sale-workspace/x/payments/y/reverse'),'payments.refund');
  assert.equal(operationPermission('POST','/sale-workspace/x/documents'),'payments.record');
  assert.equal(operationPermission('POST','/sale-workspace/x/documents/y/email'),'payments.record');
  assert.equal(operationPermission('PATCH','/staff/enquiries/x/workspace'),'sales.manage');
  assert.equal(operationPermission('POST','/enquiries'),null);
  assert.equal(operationPermission('POST','/reservations'),null);
  assert.equal(operationPermission('POST','/viewings/customer-token/cancel'),null);
  assert.equal(operationPermission('GET','/dealer-integrations'),'integrations.manage');
});
test('settings revisions reject missing, wildcard and stale clients; restoration creates a new version', () => {
  for (const value of ['*','W/"4"','-1','4.1','NaN','"4','4"']) assert.throws(()=>expectedSettingsRevision(value),SettingsVersionError);
  assert.throws(()=>expectedSettingsRevision(undefined),{status:428});
  assert.equal(expectedSettingsRevision('"4"'),4);
  assert.throws(()=>nextSettingsVersion(current,{},3,'Owner','2026-10-02T00:00:00Z'),{status:409,revision:4});
  const restored=nextSettingsVersion(current,{identity:{name:'Old dealer'}},4,'Owner','2026-10-02T00:00:00Z',1);
  assert.equal(restored.revision,5);assert.equal(restored.restoredFrom,1);assert.equal(restored.action,'restore');
  assert.equal((current.config.identity as {name:string}).name,'Dealer');
});
test('postgres publisher rejects a stale version before validation or writes and releases its connection', async () => {
  const calls: string[]=[]; let released=false,validated=false;
  const database={ query:async()=>({rows:[]}),connect:async()=>({query:async(sql:string)=>{calls.push(sql);return {rows:sql.startsWith('SELECT config, revision')?[{config:current.config,revision:4,updated_at:current.publishedAt}]:[]};},release:()=>{released=true;} })};
  const store=new PostgresSettingsVersionStore('isolated-dealer',database);
  await assert.rejects(()=>store.publish({config:{},expectedRevision:3,actor:'Owner',validate:async()=>{validated=true;return {};}}),{status:409,revision:4});
  assert.equal(validated,false);assert.equal(released,true);assert.equal(calls.at(-1),'ROLLBACK');assert.equal(calls.some(sql=>sql.startsWith('UPDATE')||sql.startsWith('INSERT')),false);
});
test('settings validation reuses the held transaction connection before committing history and publication', async () => {
  const calls:string[]=[];let released=false,connections=0;
  const client={query:async(sql:string)=>{calls.push(sql);return {rows:sql.startsWith('SELECT config, revision')?[{config:current.config,revision:4,updated_at:current.publishedAt}]:[]};},release:()=>{released=true;}};
  const database={query:async()=>{throw new Error('A second connection must not be acquired during publication.');},connect:async()=>{connections++;return client;}};
  const store=new PostgresSettingsVersionStore('isolated-dealer',database);
  const result=await store.publish({config:{identity:{name:'Updated'}},expectedRevision:4,actor:'Owner',validate:async(config,_current,held)=>{assert.equal(held,client);await held.query('SELECT visibility');return config;}});
  assert.equal(connections,1);assert.equal(released,true);assert.equal(result.revision,5);assert.equal(calls.at(-1),'COMMIT');assert.equal(calls.filter(sql=>sql.startsWith('INSERT INTO dealer_settings_versions')).length,2);assert.equal(calls.some(sql=>sql.startsWith('UPDATE dealer_settings')),true);
});
test('stock freshness uses when stock was observed and preserves the last successful sync after a failure', () => {
  const health=stockHealth([{runId:'good',status:'completed',complete:true,scrapedAt:'2026-10-01T00:00:00Z',receivedAt:'2026-10-04T10:00:00Z'},{runId:'bad',status:'quarantined',scrapedAt:'2026-10-04T11:00:00Z',receivedAt:'2026-10-04T11:00:00Z'}],new Date('2026-10-04T12:00:00Z'));
  assert.equal(health.lastSuccessfulSync,'2026-10-04T10:00:00.000Z');assert.equal(health.stale,true);assert.equal(health.ageHours,84);assert.equal(health.failuresSinceSuccess,1);
  assert.deepEqual(health.alerts.map(alert=>alert.code),['stock_stale','import_failed']);
});
function sale():SaleWorkspaceRecord { return {id:'sale-1',reference:'SALE-1',revision:1,createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-04T12:00:00Z',draft:{id:'SALE-1',customer:' =HYPERLINK("bad")',email:'',phone:'',address:'',vehicleId:'car-1',vehicle:'Car, with "quotes"',registration:'AB12CDE',price:'1000',partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'',deposit:'',paymentMethod:'',notes:'',collection:'',preparation:false,documents:false,handover:false,sourceEnquiryId:'enquiry-1',fulfilment:{method:'delivery',viewed:'viewed',address:'',recipient:'',phone:'',scheduledDate:'2026-10-06',timeWindow:'AM',instructions:''}},payments:[{id:'p1',amount:'200.00',amountPence:20000,signedAmountPence:20000,method:'Bank transfer',date:'2026-10-02',reference:'+SUM(1,2)',kind:'deposit',status:'confirmed',recordedBy:'Staff',recordedAt:'2026-10-02T12:00:00Z'},{id:'p2',amount:'50.00',amountPence:5000,signedAmountPence:-5000,method:'Bank transfer',date:'2026-10-03',reference:'Refund',kind:'refund',status:'confirmed',reversesPaymentId:'p1',reason:'Customer changed car',recordedBy:'Accounts',recordedAt:'2026-10-03T12:00:00Z'},{id:'p3',amount:'100.00',amountPence:10000,signedAmountPence:10000,method:'Bank transfer',date:'2026-10-04',reference:'pending',kind:'part-payment',status:'pending',recordedBy:'Accounts',recordedAt:'2026-10-04T12:00:00Z'}],documents:[],events:[]}; }
test('dashboard balances include refunds, exclude pending money, and conversion counts linked enquiries once',()=>{
  const one=sale(),two={...sale(),id:'sale-2',reference:'SALE-2'};
  const summary=dealerOperationsSummary({enquiries:[{id:'enquiry-1',status:'new',appointmentAt:'2026-10-05T12:00:00Z',appointmentStatus:'pending'},{id:'enquiry-2',status:'contacted'}],sales:[one,two],stockRuns:[],stockCount:3,now:new Date('2026-10-04T12:00:00Z')});
  assert.equal(summary.outstandingBalancePence,170000);assert.equal(summary.convertedEnquiries,1);assert.equal(summary.enquiryConversionPercent,50);assert.equal(summary.completedConversionPercent,0);assert.equal(summary.pendingAppointments,1);assert.equal(summary.upcomingDeliveries,2);
  const completed=dealerOperationsSummary({enquiries:[{id:'enquiry-1',status:'closed',followUpAt:'2026-10-01T00:00:00Z'},{id:'enquiry-2',status:'contacted'}],sales:[{...one,draft:{...one.draft,handover:true}}],stockRuns:[],stockCount:3,now:new Date('2026-10-04T12:00:00Z')});
  assert.equal(completed.completedConversionPercent,50);assert.equal(completed.overdueFollowUps,0);assert.equal(completed.upcomingDeliveries,0);
});
test('accountant CSV exports the actual signed ledger with safe formula cells and date filtering',()=>{
  const csv=paymentLedgerCsv([sale()]);
  assert.equal(csv.split('\r\n').length,5);assert.match(csv,/"' =HYPERLINK\(""bad""\)"/);assert.match(csv,/"'\+SUM\(1,2\)"/);assert.match(csv,/"-50","5000","-5000"/);assert.match(csv,/"p1","Customer changed car"/);
  const filtered=paymentLedgerCsv([sale()],{from:'2026-10-03',to:'2026-10-03'});assert.equal(filtered.split('\r\n').length,3);assert.match(filtered,/"p2"/);assert.doesNotMatch(filtered,/"p3"/);
});
