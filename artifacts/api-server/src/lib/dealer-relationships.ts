import { buildDealerRelationships, vehicleRegistrationLabel, type DealerRelationships, type RelationshipEnquirySource, type RelationshipEnquiryEventSource, type RelationshipReservationSource, type RelationshipReservationEventSource, type RelationshipSaleSource, type RelationshipVehicleSource } from '@workspace/vehicle-meta';
import { readDealerChatRecords } from './dealer-chat-store';

export type RelationshipReadClient = { query: (sql: string, parameters: string[]) => Promise<{ rows: Record<string, any>[] }> };

/** Every read is scoped to the configured dealer. No stock-visibility filters or history limits. */
export const relationshipQueries = {
  vehicles: `SELECT v.id, coalesce(nullif(v.website_title_override,''), nullif(v.title,''), concat_ws(' ',v.make,v.model)) AS title,
    v.registration,v.plate,v.vrm,v.year,v.registration_band AS "registrationBand",
    (coalesce(v.website_price_override,v.source_price)::bigint * 100) AS "pricePence",
    coalesce(nullif(v.website_hero_image_override,''), image.source_url, nullif(v.source_hero_image,'')) AS "imageUrl",
    CASE WHEN v.source_status='missing' AND v.inventory_status='available' THEN 'missing' ELSE v.inventory_status::text END AS status
    FROM vehicles v LEFT JOIN LATERAL (
      SELECT i.source_url FROM vehicle_images i WHERE i.vehicle_id=v.id AND i.is_active=true ORDER BY i.is_hero DESC,i.sort_order,i.id LIMIT 1
    ) image ON true WHERE v.dealer_id=$1`,
  enquiries: `SELECT id,reference,vehicle_id AS "vehicleId",vehicle_title AS "vehicleTitle",vehicle_registration AS "vehicleRegistration",
    vehicle_price AS "vehiclePrice",vehicle_url AS "vehicleUrl",type,status,customer_name AS "customerName",email,phone,message,
    staff_note AS "staffNote",call_outcome AS "callOutcome",attendance,created_at AS "createdAt",updated_at AS "updatedAt",
    appointment_at AS "appointmentAt",appointment_status AS "appointmentStatus",appointment_cancelled_at AS "appointmentCancelledAt",
    follow_up_at AS "followUpAt",follow_up_note AS "followUpNote",follow_up_completed_at AS "followUpCompletedAt",merged_into_id AS "mergedIntoId"
    FROM enquiries WHERE dealer_id=$1`,
  enquiryEvents: `SELECT id,enquiry_id AS "enquiryId",vehicle_id AS "vehicleId",vehicle_title AS "vehicleTitle",vehicle_url AS "vehicleUrl",
    kind,summary,detail->>'note' AS note,detail->>'staffName' AS "staffName",occurred_at AS "occurredAt" FROM enquiry_events WHERE dealer_id=$1 AND enquiry_id IS NOT NULL`,
  reservations: `SELECT l.id, r->>'reference' AS reference,r->>'vehicleId' AS "vehicleId",r->>'vehicleTitle' AS "vehicleTitle",
    r->>'vehicleRegistration' AS "vehicleRegistration",l.customer_name AS "customerName",coalesce(l.email,r->>'email') AS email,
    coalesce(l.phone,r->>'phone') AS phone,r->>'status' AS status,r->>'paymentStatus' AS "paymentStatus",
    r->'depositPence' AS "depositPence",r->'expectedPricePence' AS "expectedPricePence",r->'amountReceivedPence' AS "amountReceivedPence",
    r->'amountRefundedPence' AS "amountRefundedPence",r->>'createdAt' AS "createdAt",l.updated_at AS "updatedAt",
    r->>'saleId' AS "saleId",coalesce(r->>'sourceEnquiryId',l.enquiry_id::text) AS "sourceEnquiryId",r->>'mode' AS mode
    FROM lead_events e JOIN leads l ON l.id=e.lead_id CROSS JOIN LATERAL (SELECT e.payload->'reservation' AS r) record
    WHERE l.dealer_id=$1 AND e.type='note_added' AND e.payload->>'kind' IN ('online_reservation','online_stripe_reservation')
      AND r->>'dealerId'=$1 AND r->>'id'=l.id::text ORDER BY e.occurred_at,e.id`,
  reservationEvents: `SELECT e.id,l.id AS "reservationId",coalesce(nullif(e.payload->>'kind',''),e.type::text) AS type,
    e.body AS description,e.occurred_at AS "occurredAt" FROM lead_events e JOIN leads l ON l.id=e.lead_id
    WHERE l.dealer_id=$1 AND coalesce(e.payload->>'kind','') NOT IN ('online_reservation','online_stripe_reservation')
    AND EXISTS (SELECT 1 FROM lead_events original WHERE original.lead_id=l.id AND original.type='note_added'
      AND original.payload->>'kind' IN ('online_reservation','online_stripe_reservation')
      AND original.payload->'reservation'->>'dealerId'=$1 AND original.payload->'reservation'->>'id'=l.id::text)`,
  sales: `SELECT id,reference,created_at AS "createdAt",updated_at AS "updatedAt",
    jsonb_build_object('customer',state#>>'{draft,customer}','email',state#>>'{draft,email}','phone',state#>>'{draft,phone}',
      'vehicleId',state#>>'{draft,vehicleId}','vehicle',state#>>'{draft,vehicle}','registration',state#>>'{draft,registration}',
      'price',state#>>'{draft,price}','notes',state#>>'{draft,notes}','sourceEnquiryId',state#>>'{draft,sourceEnquiryId}',
      'sourceReservationId',state#>>'{draft,sourceReservationId}',
      'appointment',CASE WHEN state#>>'{draft,appointment,at}' IS NOT NULL THEN jsonb_build_object('at',state#>>'{draft,appointment,at}','status',state#>>'{draft,appointment,status}') END) AS draft,
    CASE WHEN state#>>'{lifecycle,status}' IS NOT NULL THEN jsonb_build_object('status',state#>>'{lifecycle,status}','changedAt',state#>>'{lifecycle,changedAt}') END AS lifecycle,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p->>'id','amountPence',p->'amountPence','signedAmountPence',p->'signedAmountPence',
      'method',p->>'method','date',p->>'date','reference',p->>'reference','kind',p->>'kind','status',p->>'status','recordedAt',p->>'recordedAt','reason',p->>'reason'))
      FROM jsonb_array_elements(coalesce(state->'payments','[]'::jsonb)) p),'[]'::jsonb) AS payments,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',d->>'id','number',d->>'number','type',d->>'type','title',d->>'title',
      'issuedAt',d->>'issuedAt','paymentAmountPence',d->'paymentAmountPence','snapshot',jsonb_build_object('draft',jsonb_build_object(
      'vehicleId',d#>>'{snapshot,draft,vehicleId}','vehicle',d#>>'{snapshot,draft,vehicle}','registration',d#>>'{snapshot,draft,registration}','price',d#>>'{snapshot,draft,price}'))))
      FROM jsonb_array_elements(coalesce(state->'documents','[]'::jsonb)) d),'[]'::jsonb) AS documents,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',e->>'id','type',e->>'type','description',e->>'description','occurredAt',e->>'occurredAt'))
      FROM jsonb_array_elements(coalesce(state->'events','[]'::jsonb)) e),'[]'::jsonb) AS events
    FROM sale_workspace WHERE dealer_id=$1`,
} as const;

/** The relationship service performs SELECTs only and never invokes payment or email providers. */
export async function readDealerRelationships(dealerId: string, database: RelationshipReadClient): Promise<DealerRelationships> {
  const [stock, enquiries, enquiryEvents, reservations, reservationEvents, sales, chats] = await Promise.all([
    database.query(relationshipQueries.vehicles, [dealerId]), database.query(relationshipQueries.enquiries, [dealerId]),
    database.query(relationshipQueries.enquiryEvents, [dealerId]), database.query(relationshipQueries.reservations, [dealerId]),
    database.query(relationshipQueries.reservationEvents, [dealerId]), database.query(relationshipQueries.sales, [dealerId]),
    readDealerChatRecords(dealerId, database),
  ]);
  const events = reservationEvents.rows as RelationshipReservationEventSource[];
  const cancelled = new Map(events.filter(e => e.type === 'online_reservation_cancelled').map(e => [e.reservationId, e.occurredAt]));
  return buildDealerRelationships({
    vehicles: stock.rows.map(v => ({ ...v, registration: vehicleRegistrationLabel(v), pricePence: v.pricePence == null ? null : Number(v.pricePence) })) as RelationshipVehicleSource[],
    enquiries: enquiries.rows as RelationshipEnquirySource[], enquiryEvents: enquiryEvents.rows as RelationshipEnquiryEventSource[],
    reservations: reservations.rows.map(r => ({ ...r, ...(cancelled.has(r.id) ? { status: 'cancelled', cancelledAt: cancelled.get(r.id) } : {}) })) as RelationshipReservationSource[],
    reservationEvents: events,
    sales: sales.rows.map(s => ({ ...s, createdAt: new Date(s.createdAt).toISOString(), updatedAt: new Date(s.updatedAt).toISOString() })) as RelationshipSaleSource[],
    chats: chats.map(({ conversation: chat, messages }) => ({ id: chat.id, reference: chat.reference, enquiryId: chat.enquiryId, status: chat.status,
      vehicleId: chat.vehicle?.id, vehicleTitle: chat.vehicle?.title, vehicleRegistration: chat.vehicle?.registration,
      createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages })),
  });
}
