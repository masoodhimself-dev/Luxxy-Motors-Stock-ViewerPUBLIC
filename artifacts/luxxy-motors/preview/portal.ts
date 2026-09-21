// Read-only examples for visual review. No real customers or transactions.
import { previewStock } from './stock';
const now = Date.now();
const at = (hours: number) => new Date(now + hours * 3600000).toISOString();
export const leads = ['Amelia Clarke', 'James Bennett', 'Olivia Reed', 'Thomas Wilson'].map(
  (customerName, i) => ({
    id: `sample-lead-${i + 1}`,
    customerName,
    email: `customer${i + 1}@example.com`,
    phone: '07700 900123',
    source: i === 0 ? 'website_form' : i === 1 ? 'phone' : 'walk_in',
    stage: i === 0 ? 'viewing_booked' : i === 1 ? 'offer' : 'new',
    vehicleId: previewStock.cars[i].id,
    vehicleTitle: previewStock.cars[i].title,
    vehicleRegistration: previewStock.cars[i].registration,
    owner: 'Alex',
    summary: 'Interested in a viewing. Please confirm availability and service history.',
    nextAction:
      i === 0
        ? 'Prepare vehicle for viewing'
        : i === 1
          ? 'Call back with part-exchange details'
          : 'Reply to vehicle enquiry',
    nextActionDueAt: at(i === 1 ? -4 : 2),
    appointmentAt: i === 0 ? at(3) : null,
    depositPence: i === 3 ? 50000 : 0,
    depositTakenAt: i === 3 ? at(-2) : null,
    createdAt: at(-24 - i * 8),
    updatedAt: at(-2),
    lastActivityAt: at(-2),
    closedAt: null,
    outcomeReason: null,
    enquiryId: null,
  }),
);
const sale = {
  id: 'sample-sale-1',
  status: 'draft',
  agreedPricePence: 1210400,
  depositPence: 50000,
  balancePence: 1160400,
  currency: 'GBP',
  createdAt: at(-24),
  updatedAt: at(-2),
  vehicle: previewStock.cars[0],
  customer: {
    id: 'sample-customer',
    name: leads[0].customerName,
    email: leads[0].email,
    phone: leads[0].phone,
  },
  latestRevision: null,
  signingSession: null,
  invoice: null,
};
export function previewResponse(path: string, query: URLSearchParams): unknown {
  if (path === '/api/portal/session')
    return { state: 'authorised', name: 'Alex', email: 'alex@example.com' };
  if (path === '/api/portal/worklist')
    return {
      generatedAt: at(0),
      viewingsToday: [leads[0]],
      overdueFollowUps: [leads[1]],
      unansweredEnquiries: [leads[2]],
      depositsWithoutDeal: [leads[3]],
    };
  if (path === '/api/leads')
    return leads.filter(
      (lead) =>
        (!query.get('search') ||
          `${lead.customerName} ${lead.vehicleTitle}`
            .toLowerCase()
            .includes(query.get('search')!.toLowerCase())) &&
        (!query.get('stage') || ['all', 'open', lead.stage].includes(query.get('stage')!)) &&
        (!query.get('source') || ['all', lead.source].includes(query.get('source')!)),
    );
  if (path === '/api/leads/summary')
    return ['website_form', 'phone', 'whatsapp', 'walk_in', 'marketplace', 'social'].map(
      (source, i) => ({ source, total: 8 + i, open: 3, won: 4 + i, lost: 1 }),
    );
  const lead = leads.find((item) => path === `/api/leads/${item.id}`);
  if (lead)
    return {
      lead,
      deal: null,
      enquiryMessage: lead.summary,
      activities: [
        {
          id: 'sample-activity',
          kind: 'call',
          body: 'Discussed the vehicle and answered questions about service history. Customer would like to view this week.',
          occurredAt: at(-2),
          actor: 'Alex',
        },
      ],
    };
  if (path === '/api/enquiries') return [];
  if (path === '/api/sales') return [sale];
  if (path === `/api/sales/${sale.id}`) return sale;
  if (path.endsWith('/checklist'))
    return {
      saleId: sale.id,
      completedCount: 0,
      totalCount: 3,
      readyForPreparation: false,
      readyForCompletion: false,
      items: ['customer_details', 'vehicle_details', 'agreed_price'].map((code) => ({
        code,
        label: code.replaceAll('_', ' '),
        message: 'Review and confirm the current record.',
        description: '',
        status: 'pending',
        required: true,
        eligible: true,
        canMarkNotApplicable: false,
        completedAt: null,
        completedBy: null,
      })),
    };
  if (path.endsWith('/final-checks'))
    return {
      canComplete: false,
      checks: [
        {
          code: 'signature',
          label: 'Customer signature',
          passed: false,
          message: 'Prepare the document pack after completing the checklist.',
        },
      ],
    };
  if (path === '/api/viewings/sample')
    return {
      reference: 'PREVIEW-001',
      status: 'booked',
      customerName: 'Amelia',
      appointmentAt: at(48),
      cancelledAt: null,
      timezone: 'Europe/London',
      vehicleTitle: previewStock.cars[0].title,
      vehicleUrl: '/vehicle/preview-1',
      calendarIcs: '',
      canChange: true,
    };
  if (path === '/api/customer-intake-sessions/sample')
    return {
      id: 'sample',
      vehicleId: 'preview-1',
      status: 'pending',
      expiresAt: at(48),
      customer: null,
    };
  if (path === '/api/signing/sample')
    return {
      developmentOnly: true,
      warning: 'Visual preview only. No signature will be recorded.',
      session: { status: 'pending', expiresAt: at(48) },
      sale,
      customer: sale.customer,
      revision: {
        revisionNumber: 1,
        packHash: 'sample',
        snapshot: {
          vehicle: {
            id: previewStock.cars[0].id,
            value: previewStock.cars[0].title,
            registration: previewStock.cars[0].registration,
            mileage: previewStock.cars[0].mileage,
          },
          details: sale.customer,
        },
        documents: [{
          id: 'sample-order',
          title: 'Development vehicle sale summary',
          content: `DEVELOPMENT ONLY — NOT A LEGAL CONTRACT

Vehicle: ${previewStock.cars[0].title}
Customer: ${sale.customer.name}

Review the vehicle, agreed price and disclosures with the dealer before proceeding.

This sample document is for visual review. No signature will be recorded.`,
          contentHash: 'sample-content',
          required: true,
        }],
        acknowledgements: [
          { code: 'vehicle', statement: 'I have checked the vehicle and purchase details.' },
        ],
      },
    };
  if (path === '/api/enquiries/availability') {
    const date = query.get('date');
    return {
      date,
      timezone: 'Europe/London',
      slots: ['10:00', '10:30', '11:30', '13:00', '14:00', '15:30'].map((label) => ({
        label,
        startAt: `${date}T${label}:00.000Z`,
        available: true,
      })),
    };
  }
  return undefined;
}
