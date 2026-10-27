import assert from 'node:assert/strict';
import test from 'node:test';
import * as contracts from '../../../lib/api-zod/src/generated/api';

const input={vehicleId:null,customerName:'Fictional Buyer',email:'buyer@example.test',phone:'07700900123',preferredContact:'email',message:'Please contact me.',appointmentAt:null};

test('new public enquiries accept only the retained enquiry, booking and part-exchange routes',()=>{
  for(const type of ['general','viewing','part_exchange'])assert.equal(contracts.CreateEnquiryBody.safeParse({...input,type}).success,true,type);
  for(const type of ['delivery','warranty','reservation','chat'])for(const schema of [contracts.CreateEnquiryBody,contracts.CreateStaffEnquiryBody])assert.equal(schema.safeParse({...input,type}).success,false,type);
});

test('new online reservation creation has no generated request validator',()=>{
  assert.equal('CreateReservationBody' in contracts,false);
});

test('stored historical enquiry types remain readable without enabling new creation',()=>{
  const type=contracts.GetEnquiriesResponse.element.shape.type;
  assert.equal(type.safeParse('delivery').success,true);
  assert.equal(type.safeParse('warranty').success,true);
});

test('retired online reservation and recent-handover Settings controls have no new-write schema',()=>{
 assert.equal('onlineReservation' in contracts.UpdateDealerSettingsBody.shape,false);
 assert.equal('recentHandovers' in contracts.UpdateDealerSettingsBody.shape,false);
 assert.equal('GetRecentHandoversResponse' in contracts,false);
});
