import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry, StaffOnlineReservation } from "@workspace/api-client-react";
import {
  changeSaleWorkspace,
  createSaleWorkspace,
  requestSalePayment,
  saleWorkspaceTotals,
  saleCompletionChecklistItems,
  partExchangeChecklistItems,
  type SaleWorkspaceRecord,
  type SaleWorkspaceContext,
  type SaleWorkspaceCommand,
} from "@workspace/vehicle-meta";
const state = vi.hoisted(() => ({
  sales: [] as SaleWorkspaceRecord[],
  enquiries: [] as Enquiry[],
  reservations: [] as StaffOnlineReservation[],
  search: "",
  enquiriesError: false,
  stockLoading: false,
  stockError: null as string | null,
  customerEmails: true,
  invoiceQrEnabled: true,
  featuresLoading: false,
  featuresError: false,
  fetch: vi.fn(),
  pdf: vi.fn(),
  stock: {
    cars: [
      {
        id: "car-test",
        title: "Ford Focus",
        make: "Ford",
        model: "Focus",
        plate: "AB20 XYZ",
        price: 10000,
        year: 2020,
        fuel: "Petrol",
        transmission: "Manual",
        mileage: 22000,
        colour: "Blue",
        images: [],
        heroImage: null as string | null,
        inventoryStatus: "available",
      },
    ],
  },
}));
vi.mock("@/lib/stock-context", () => ({
  useStock: () => ({ stock: state.stock, isLoading: state.stockLoading, error: state.stockError }),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: {
      identity: { name: "Test Motors" },
      contact: {},
      address: {},
      legal: {},
    },
  }),
}));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({
  enabled: (feature: string) => feature !== 'customerEmails' || state.customerEmails,
  isLoading: state.featuresLoading, isError: state.featuresError, isFetching: false, refetch: vi.fn(),
}) }));
vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
  useSearch: () => state.search,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => {
    const url = String(args[0]);
    if (url === '/api/sales-terms') return Promise.resolve({ published: null });
    if (url.startsWith('/api/sales-terms/sales/')) return Promise.resolve({ documents: [] });
    if (url.includes('/delivery-evidence')) return Promise.resolve({ jobs: [] });
    return state.fetch(...args);
  },
  HttpApiError: class extends Error {},
  getGetStockQueryKey: () => ["stock"],
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  useGetEnquiries: () => ({ data: state.enquiries, isError: state.enquiriesError }),
  useListReservations: () => ({ data: { reservations: state.reservations } }),
}));
vi.mock("@/components/sales-demo/sales-document", async () => ({
  ...await vi.importActual<typeof import('@/components/sales-demo/sales-document')>('@/components/sales-demo/sales-document'),
  LiveSalesDocument: () => <div aria-label="Live document preview"/>,
  openSaleDocumentPdf: (...args: unknown[]) => state.pdf(...args),
}));
vi.mock('@/components/portal/sale-review-reminder', () => ({ SaleReviewReminder: () => null }));
vi.mock('@/components/portal/sold-vehicle-customer-review', () => ({ SoldVehicleCustomerReview: () => null }));
vi.mock('@/components/portal/dealer-administration', () => ({useStaffAccess: () => ({data:{permissions:['sales.manage','sales.handover','payments.record','payments.refund']}})}));
vi.mock('@/components/share-qr',()=>({ShareQr:({source,documentType,onEmailFallback,disabled,label}:{source?:{documentId?:string};documentType?:string;onEmailFallback?:()=>void;disabled?:boolean;label?:string})=>documentType==='invoice'&&!state.invoiceQrEnabled?null:<button disabled={disabled} data-document-id={source?.documentId} onClick={onEmailFallback}>{label === 'WhatsApp confirmation' ? label : 'Use email instead'}</button>}));
import { SalesWorkspace } from "./sales-demo";
import { emptyDraft } from "@/components/sales-demo/model";
const initialStockCars = structuredClone(state.stock.cars);
let serial = 0;
const context = (): SaleWorkspaceContext => ({
  now: new Date().toISOString(),
  actor: "Test staff",
  nextId: () => `generated-${++serial}`,
  nextNumber: (type) => `${type}-${++serial}`,
  branding: {
    identity: { name: "Test Motors", logoText: "TEST", logoAsset: "" },
    contact: { phone: "", email: "" },
    address: { street: "", city: "", region: "", postcode: "" },
    legal: { companyName: "", companyNumber: "", vatNumber: "" },
  },
});
beforeEach(() => {
  state.sales = [];
  state.enquiries = [];
  state.reservations = [];
  state.search = "";
  state.enquiriesError = false;
  state.stockLoading = false;
  state.stockError = null;
  state.customerEmails = true;
  state.invoiceQrEnabled = true;
  state.featuresLoading = false;
  state.featuresError = false;
  state.stock.cars = structuredClone(initialStockCars);
  state.pdf.mockReset();
  serial = 0;
  state.fetch
    .mockReset()
    .mockImplementation(
      async (url: string, options?: { method?: string; body?: string }) => {
        if (!options?.method) {
          if (url === '/api/sales-terms') return { published: null };
          if (url.startsWith('/api/sales-terms/sales/')) return { documents: [] };
          if (url.includes('/delivery-evidence')) return { jobs: [] };
          const path = new URL(url, 'https://example.test');
          const match = /^\/api\/sale-workspace\/([^/]+)$/.exec(path.pathname);
          if (match) return { sale: state.sales.find(sale => sale.id === match[1]) };
          const enquiryId = path.searchParams.get('enquiryId'), reservationId = path.searchParams.get('reservationId');
          return { sales: state.sales.filter(sale => (!enquiryId || sale.draft.sourceEnquiryId === enquiryId) && (!reservationId || sale.draft.sourceReservationId === reservationId)), hasMore: false };
        }
        const payload = JSON.parse(options.body!);
        if (options.method === 'DELETE') {
          const id = url.split('/').at(-1);
          state.sales = state.sales.filter(sale => sale.id !== id);
          return { deleted: true, id };
        }
        if (url === "/api/sale-workspace") {
          const result = createSaleWorkspace(
            { draft: payload.draft, requestId: payload.requestId },
            context(),
            "SALE-001",
          );
          state.sales.push(result.sale);
          return result;
        }
        const current = state.sales[0];
        if(url.endsWith('/request-payment')){
          const result=requestSalePayment(current,{...payload,tokenHash:'test-token-hash',expiresAt:new Date(Date.now()+30*86400000).toISOString()},context());
          state.sales[0]=result.sale;return {...result,requestId:result.request.id,url:`https://example.test/payment-request/${'a'.repeat(64)}`};
        }
        if (url.endsWith('/email')) {
          const documentId = url.split('/documents/')[1].split('/')[0];
          const result = changeSaleWorkspace(current, {action:'email-status',delivery:{id:payload.requestId,documentId,to:current.draft.email,status:'sent',attemptedAt:context().now}}, payload,context());
          state.sales[0]=result.sale;return result;
        }
        const pendingPayment = /\/payments\/([^/]+)\/confirm$/.exec(url);
        if (pendingPayment) {
          const result = changeSaleWorkspace(current, { action: 'confirm', paymentId: pendingPayment[1], date: payload.date, reserveVehicle: payload.reserveVehicle, reserveConfirmed: payload.reserveConfirmed, acceptShortfall: payload.acceptShortfall }, payload, context());
          state.sales[0] = result.sale;
          return result;
        }
        const action =
          options.method === "PUT"
            ? { action: "update", draft: payload.draft }
            : url.endsWith("/invoice-payments")
              ? { action: "invoice-payment", payment: payload.payment }
              : url.endsWith('/checklists')
                ? { action: 'checklists', completion: payload.completion, partExchanges: payload.partExchanges }
              : url.endsWith("/issue-invoice")
                ? {
                    action: "issue-invoice",
                    kind: payload.kind,
                    acknowledge: payload.acknowledge,
                  }
                : {
                    action: "finish-invoice-sale",
                    acknowledge: payload.acknowledge,
                    acknowledgeOutstanding: payload.acknowledgeOutstanding,
                  };
        const result = changeSaleWorkspace(
          current,
          action as SaleWorkspaceCommand,
          payload,
          context(),
        );
        state.sales[0] = result.sale;
        return result;
      },
    );
});
function mount(props: Parameters<typeof SalesWorkspace>[0] = {}) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SalesWorkspace {...props} />
    </QueryClientProvider>,
  );
}
it('deletes an eligible saved draft only after explicit confirmation and keeps other sales', async () => {
  const testSale = createSaleWorkspace({draft:{...emptyDraft(),customer:'[TEST] Unissued sale',vehicle:'Ford Focus'},requestId:'test-draft-create'},context(),'TEST-DRAFT').sale;
  testSale.emptyDraftDeletable=true;
  const real = createSaleWorkspace({draft:{...emptyDraft(),customer:'Protected buyer',vehicle:'Ford Focus'},requestId:'real-draft-create'},context(),'REAL-DRAFT').sale;
  real.emptyDraftDeletable=false;state.sales=[testSale,real];mount();
  fireEvent.click(await screen.findByRole('button',{name:/\[TEST\] Unissued sale/}));
  await openCarScreen();
  fireEvent.click(screen.getByText('Sale actions'));fireEvent.click(screen.getByRole('button',{name:'Delete draft'}));
  const dialog=screen.getByRole('dialog',{name:'Delete this draft?'});
  expect(state.fetch.mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button',{name:'Keep draft'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Delete draft'}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete draft permanently'}));
  await screen.findByRole('heading',{name:'Sales'});
  expect(state.sales.map(sale=>sale.id)).toEqual([real.id]);
  const deletion=state.fetch.mock.calls.find(([,options])=>options?.method==='DELETE');
  expect(deletion?.[0]).toBe(`/api/sale-workspace/${testSale.id}`);
  expect(JSON.parse(deletion?.[1].body)).toEqual({confirm:true,expectedRevision:1});
  expect(screen.getByRole('status')).toHaveTextContent('Draft deleted.');
  fireEvent.click(screen.getByRole('button',{name:/Protected buyer/}));
  await openCarScreen();
  expect(screen.queryByRole('button',{name:'Delete draft'})).not.toBeInTheDocument();
});

it('keeps the draft when deletion fails and reloads protected changes before another attempt', async()=>{
  const sale=createSaleWorkspace({draft:{...emptyDraft(),customer:'[TEST] Stale draft'},requestId:'stale-create'},context(),'TEST-STALE').sale;
  sale.emptyDraftDeletable=true;state.sales=[sale];
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url,options)=>{if(options?.method==='DELETE')throw new Error('This sale changed on another device. Reload it before deleting.');return original(url,options);});
  mount();fireEvent.click(await screen.findByRole('button',{name:/\[TEST\] Stale draft/}));
  await openCarScreen();
  fireEvent.click(screen.getByText('Sale actions'));fireEvent.click(screen.getByRole('button',{name:'Delete draft'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete draft permanently'}));
  await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('another device'));
  expect(state.sales).toHaveLength(1);
  state.sales=[{...sale,revision:2,emptyDraftDeletable:false}];
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Reload saved sales'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('button',{name:'Delete draft'})).not.toBeInTheDocument();
});
it("returns an embedded invoice to the sales list and keeps the unsaved-change guard", async () => {
  const onExit = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    mount({ embedded: true, onExit });
    await details("full");
    fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'100'}});
    fireEvent.click(screen.getByRole("button", { name: "Back to sales" }));
    expect(confirm).toHaveBeenCalledWith("Leave your unsaved invoice details?");
    expect(screen.getByRole("heading", { name: "Take a payment" })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to sales" }));
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to workspace" }));
    expect(onExit).toHaveBeenCalledOnce();
  } finally {
    confirm.mockRestore();
  }
});
function chooseStockVehicle(id: string) {
  const chooser = screen.getByRole("region", { name: "Vehicle selection" });
  if (!within(chooser).queryByLabelText("Matching stock vehicles")) {
    fireEvent.click(within(chooser).getByRole("button", { name: "Change vehicle" }));
  }
  const option = within(chooser).getAllByRole("button").find(button => button.getAttribute("data-vehicle-id") === id);
  expect(option).toBeDefined();
  fireEvent.click(option!);
}
function navigateSection(section: string) {
 if (section === 'Deal') { fireEvent.click(screen.getByRole('button', { name: 'Car' })); return; }
 const heading = section === 'Deposit' ? 'Take a deposit' : section === 'Payments' ? 'Take a payment' : section === 'Invoices' ? 'Create an invoice' : 'Arrange collection or delivery';
 const menu = screen.queryByRole('button', {name: new RegExp(`^${heading}`)});
 if (!menu) openActions();
 fireEvent.click(screen.getByRole('button', {name: new RegExp(`^${heading}`)}));
}
function openActions(){
 if(screen.queryByRole('button',{name:/^Request a deposit/}))return;
 let back=screen.queryAllByRole('button',{name:'All actions'});
 if(!back.length && screen.queryByRole('button',{name:'Choose customer'})){fireEvent.click(screen.getByRole('button',{name:'Choose customer'}));back=screen.queryAllByRole('button',{name:'All actions'});}
 if(back.length)fireEvent.click(back[0]);else fireEvent.click(screen.getByRole('button',{name:'Choose what to do'}));
}
function openCustomerFields(){const next=screen.queryByRole('button',{name:'Choose customer'});fireEvent.click(next || screen.getByRole('button',{name:'Customer'}));}
function saleSummary(){return document.querySelector('.sale-desk') as HTMLElement;}
async function openCarScreen() {
 await screen.findByRole('heading', {name:/Choose a car|Choose the customer|What would you like to do\?/});
 fireEvent.click(screen.getByRole('button',{name:'Car'}));
 return screen.getByRole('heading',{name:'Choose a car'});
}
async function advance() {
 const customer = screen.queryByRole('button',{name:'Choose customer'});
 if (customer) { fireEvent.click(customer); await screen.findByLabelText('Customer’s full name'); return; }
 const next = screen.getAllByRole('button',{name:'Choose what to do'}).find(button => !button.closest('nav'));
 if(next){fireEvent.click(next);await screen.findByRole('heading',{name:'What would you like to do?'});}
}
function openPayments() { navigateSection('Payments'); }
function openInvoice() {
 navigateSection('Invoices');
 const options=screen.queryAllByRole('button',{name:'View & share'});const invoice=options.find(button=>/invoice/i.test(button.parentElement?.textContent??''));if(invoice)fireEvent.click(invoice);else if(options.length)fireEvent.click(options[0]);
}
function confirmDocumentEmail(email = 'jamie@example.com') {
 const review = screen.getByRole('dialog', { name: 'Email this document?' });
 expect(review).toHaveTextContent(`Send the saved PDF to ${email}.`);
 fireEvent.click(within(review).getByRole('button', { name: /^Send email$/ }));
}
async function details(_type:'deposit'|'full') {
 fireEvent.click(await screen.findByRole('button',{name:/New sale/}));
 expect(screen.getByRole('heading',{name:'Choose a car'})).toBeVisible();
 chooseStockVehicle('car-test');await advance();
 fireEvent.change(screen.getByLabelText('Customer’s full name'),{target:{value:'Jamie Taylor'}});
 await advance(); openPayments();
}
async function pay(amount:string,kind:'deposit'|'part-payment'|'final-payment',method:string) {
 if(kind === 'deposit') navigateSection('Deposit'); else if(!screen.queryByLabelText('Payment type'))openPayments();
 if(kind !== 'deposit') fireEvent.change(screen.getByLabelText('Payment type'),{target:{value:kind}});
 fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:amount}});
 fireEvent.change(screen.getByLabelText('Payment method'),{target:{value:method}});
 fireEvent.click(screen.getByRole('checkbox',{name:/I have checked that this money/}));
 const beforeCount=state.sales[0]?.payments.length??0;fireEvent.click(screen.getByRole('button',{name:/^Save (?:£[\d,.]+ )?(?:deposit|payment)$/}));
 if(kind === 'deposit') fireEvent.click(await screen.findByRole('button',{name:/^Confirm £[\d,.]+ & reserve car$/}));
 await waitFor(()=>expect(state.sales[0].payments).toHaveLength(beforeCount+1));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'All actions'}).every(button => !button.hasAttribute('disabled'))).toBe(true));
}
async function issue(type:'deposit'|'full') {
 navigateSection('Invoices');
 const create=screen.queryByRole('button',{name:'Create invoice'});if(create)fireEvent.click(create);
 fireEvent.click(screen.getByRole('button',{name:type==='deposit'?'Received deposit invoice':'Sales invoice'}));
 fireEvent.click(screen.getByRole('checkbox',{name:/I have checked the customer/}));
 fireEvent.click(screen.getByRole('button',{name:'Create & save invoice'}));
 await screen.findByRole('button',{name:'Open & print invoice'});
}
it("creates deposit and full invoices with interim payments, and asks before marking the car sold", async () => {
  mount();
  await details("deposit");
  expect(
    screen.queryByText(/Live invoice|Invoice preview/),
  ).not.toBeInTheDocument();
  expect(state.pdf).not.toHaveBeenCalled();
  await pay("500", "deposit", "Cash");
  await issue("deposit");
  expect(state.sales[0].lifecycle?.status).toBe("reserved");
  expect(state.sales[0].documents.filter(doc => doc.type === 'invoice')).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Return to this sale" }));
  await pay("1000", "part-payment", "Bank transfer");
  await pay("8500", "final-payment", "Debit card");
  await issue("full");
  expect(state.sales[0].documents.filter(doc => doc.type === 'invoice')).toHaveLength(2);
  expect(state.sales[0].documents.at(-1)!.snapshot.payments).toHaveLength(3);
  expect(state.sales[0].lifecycle?.status).toBe("reserved");
  await completeFinalChecks();
  fireEvent.click(
    screen.getByRole("button", { name: "Yes, mark sold & remove" }),
  );
  await waitFor(() => expect(state.sales[0].lifecycle?.status).toBe("sold"));
});
it("allows an unpaid full invoice but requires acknowledgement before marking the car sold", async () => {
  mount();
  await details("full");
  await issue("full");
  expect(
    screen.getByRole("button", { name: "Yes, mark sold & remove" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "No, keep its current status" }),
  );
  expect(state.sales[0].completedAt).toBeUndefined();
  expect(state.sales[0].lifecycle).toBeUndefined();
  expect(state.pdf).not.toHaveBeenCalled();
});
it('blocks overpayments and prevents creating an invoice for an unreceived deposit', async () => {
 mount();await details('deposit');fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'10001'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/I have checked that this money/}));expect(screen.getByRole('button',{name:/^Save (?:£[\d,.]+ )?(?:deposit|payment)$/})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:''}});navigateSection('Invoices');
 fireEvent.click(screen.getByRole('button',{name:'Received deposit invoice'}));fireEvent.click(screen.getByRole('checkbox',{name:/I have checked the customer/}));fireEvent.click(screen.getByRole('button',{name:'Create & save invoice'}));
 await waitFor(()=>expect(document.body).toHaveTextContent(/received deposit|confirmed deposit/i));expect(state.sales.flatMap(sale=>sale.documents)).toHaveLength(0);
});

it('does not silently drop a typed but unrecorded payment when staff switch sections', async () => {
 mount();await details('full');fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'500'}});
 navigateSection('Invoices');expect(screen.getByRole('button',{name:'Create & save invoice'})).toBeDisabled();
 expect(screen.getByText('Save or clear the payment entry in Payments before creating an invoice.')).toBeVisible();
 navigateSection('Payments');expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('500');expect(state.sales[0].payments).toHaveLength(0);
});

it('takes an unfinished payment back to its entry instead of looping on save when requesting a deposit', async () => {
 mount(); await details('full');
 fireEvent.change(screen.getByLabelText('Payment amount (£)'), { target: { value: '500' } });
 fireEvent.click(screen.getAllByRole('button', { name: 'All actions' })[0]);
 fireEvent.click(within(screen.getByLabelText('Choose what to do')).getByRole('button', { name: /^Request a deposit/ }));
 expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Return to unfinished payment' }));
 expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('500');
 expect(state.sales[0].payments).toHaveLength(0);
});

it("supports an explicitly agreed sale with a balance due and records the later final payment", async () => {
  mount();
  await details("full");
  await issue("full");
  await completeFinalChecks();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I confirm the sale can proceed/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Yes, mark sold & remove" }),
  );
  await waitFor(() => expect(state.sales[0].lifecycle?.status).toBe("sold"));
  fireEvent.click(screen.getByRole("button", { name: "Return to this sale" }));
  await pay("10000", "final-payment", "Bank transfer");
  await issue("full");
  expect(state.sales[0].documents).toHaveLength(2);
  expect(state.sales[0].documents[1].balanceAtIssue).toBe(0);
  expect(state.sales[0].lifecycle?.status).toBe("sold");
});

it('requires the car and customer before issuing an invoice', async () => {
 mount();fireEvent.click(await screen.findByRole('button',{name:/New sale/}));
 expect(screen.queryByRole('button',{name:/^Create an invoice/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Choose customer'}));
 expect(screen.getByRole('alert')).toHaveTextContent('Select a vehicle');
 chooseStockVehicle('car-test');fireEvent.click(screen.getByRole('button',{name:'Choose customer'}));
 fireEvent.click(screen.getAllByRole('button',{name:'Choose what to do'}).find(button=>!button.closest('nav'))!);
 expect(screen.getByRole('alert')).toHaveTextContent('Enter the customer name');expect(state.sales).toHaveLength(0);
});

it("calculates a fee, discount and part exchange exactly before issuing the full invoice", async () => {
  mount();
  await details("full");
  openActions();fireEvent.click(screen.getByRole("button", { name: "Extras or part exchange" }));
  fireEvent.click(screen.getByRole("button", { name: /Add fee or discount/ }));
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Admin fee" },
  });
  fireEvent.change(screen.getByLabelText("Amount (£)"), {
    target: { value: "2.50" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Add fee or discount/ }));
  fireEvent.change(screen.getAllByLabelText("Type")[1], {
    target: { value: "discount" },
  });
  fireEvent.change(screen.getAllByLabelText("Description")[1], {
    target: { value: "Agreed discount" },
  });
  fireEvent.change(screen.getAllByLabelText("Amount (£)")[1], {
    target: { value: "100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add part exchange" }));
  fireEvent.change(screen.getByLabelText("Part-exchange registration"), {
    target: { value: "CD12EFG" },
  });
  fireEvent.change(screen.getByLabelText("Vehicle description"), {
    target: { value: "Ford Fiesta" },
  });
  fireEvent.change(screen.getByLabelText("Allowance (£)"), {
    target: { value: "1000" },
  });
  await pay("8902.50", "final-payment", "Bank transfer");
  await issue("full");
  expect(state.sales[0].documents[0].snapshot.totals.totalDue).toBe(890250);
  expect(state.sales[0].documents[0].balanceAtIssue).toBe(0);
});


function recentEnquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  return {
    id: "enquiry-recent",
    reference: "ENQ-RECENT",
    customerName: "Jamie Taylor",
    phone: "07700900123",
    email: "jamie@example.com",
    vehicleId: "car-test",
    vehicleTitle: "Ford Focus",
    createdAt: "2026-10-17T09:00:00Z",
    updatedAt: "2026-10-18T09:00:00Z",
    ...overrides,
  } as Enquiry;
}
async function openCustomerStep() {
  fireEvent.click(await screen.findByRole("button", { name: /New sale/ }));
  chooseStockVehicle("car-test");
  await advance();
}

it("shows the selected car and agreed price beside the customer details", async () => {
  state.stock.cars[0].heroImage = "https://images.example.com/ford-focus.jpg";
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /New sale/ }));
  chooseStockVehicle("car-test");
  fireEvent.change(screen.getByLabelText("Agreed vehicle price (£)"), {
    target: { value: "9750" },
  });
  await advance();

  const car = saleSummary();
  expect(car).toHaveTextContent("Ford Focus");
  expect(car).toHaveTextContent(/AB20\s*XYZ/);
  expect(car).toHaveTextContent("£9,750.00");
  expect(car).not.toHaveTextContent("£10,000.00");
  expect(within(car).getByRole("button", { name: "Enlarge photo of Ford Focus" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Car" })).toBeEnabled();
  expect(screen.getByLabelText("Customer’s full name")).toBeEnabled();
  expect(mutations()).toHaveLength(0);
});

it("returns to the vehicle step without losing entered customer details", async () => {
  mount();
  await openCustomerStep();
  fireEvent.change(screen.getByLabelText("Customer’s full name"), { target: { value: "Jamie Taylor" } });
  fireEvent.change(screen.getByLabelText("Telephone"), { target: { value: "07700900123" } });
  fireEvent.change(screen.getByLabelText("Email for the invoice"), { target: { value: "jamie@example.com" } });
  fireEvent.change(screen.getByLabelText("Customer address"), { target: { value: "10 Test Road" } });

  fireEvent.click(screen.getByRole("button", { name: "Car" }));
  expect(screen.getByRole("heading", { name: "Choose a car" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Vehicle selection" })).toHaveTextContent("Ford Focus selected");
  expect(screen.queryByRole("complementary", { name: "Selected car" })).not.toBeInTheDocument();
  await advance();

  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Jamie Taylor");
  expect(screen.getByLabelText("Telephone")).toHaveValue("07700900123");
  expect(screen.getByLabelText("Email for the invoice")).toHaveValue("jamie@example.com");
  expect(screen.getByLabelText("Customer address")).toHaveValue("10 Test Road");
  expect(mutations()).toHaveLength(0);
});

it("updates the customer-step car summary and saved draft after changing vehicles", async () => {
  state.stock.cars.push({
    ...state.stock.cars[0], id: "car-second", title: "Toyota Yaris", make: "Toyota", model: "Yaris",
    plate: "CD19 EFG", year: 2019, colour: "Red", transmission: "Automatic", mileage: 34000, price: 7500,
  });
  mount();
  await openCustomerStep();
  fireEvent.change(screen.getByLabelText("Customer’s full name"), { target: { value: "Jamie Taylor" } });
  fireEvent.click(screen.getByRole("button", { name: "Car" }));
  chooseStockVehicle("car-second");
  expect(screen.getByLabelText("Agreed vehicle price (£)")).toHaveValue("7500");
  await advance();

  const car = saleSummary();
  expect(car).toHaveTextContent("Toyota Yaris");
  expect(car).toHaveTextContent(/CD19\s*EFG/);
  expect(car).toHaveTextContent("£7,500.00");
  expect(car).not.toHaveTextContent("Ford Focus");
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Jamie Taylor");
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(state.sales).toHaveLength(1));
  expect(state.sales[0].draft).toMatchObject({
    customer: "Jamie Taylor", vehicleId: "car-second", vehicle: "Toyota Yaris", registration: "CD19 EFG", price: "7500",
  });
});

async function selectRecentCustomer(query = "Jamie") {
  const name = screen.getByRole("combobox", { name: "Customer’s full name" });
  fireEvent.focus(name);
  fireEvent.change(name, { target: { value: query } });
  fireEvent.click(await screen.findByRole("option", { name: /Jamie Taylor/ }));
}

it("autofills a recent enquiry contact as staff type and links only the selected same-car enquiry", async () => {
  state.enquiries = [recentEnquiry()];
  mount();
  await openCustomerStep();
  expect(screen.queryByLabelText("Use recent customer")).not.toBeInTheDocument();
  await selectRecentCustomer();
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Jamie Taylor");
  expect(screen.getByLabelText("Telephone")).toHaveValue("07700900123");
  expect(screen.getByLabelText("Email for the invoice")).toHaveValue("jamie@example.com");
  expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(state.sales).toHaveLength(1));
  expect(state.sales[0].draft.sourceEnquiryId).toBe("enquiry-recent");
  expect(state.sales[0].draft.sourceReservationId).toBe("");
  expect(document.body).not.toHaveTextContent('ENQ-RECENT');
});

it("reuses a returning customer's contact without linking another car's enquiry or retaining a previous address", async () => {
  state.enquiries = [recentEnquiry({ vehicleId: "another-car", vehicleTitle: "Toyota Yaris" })];
  mount();
  await openCustomerStep();
  fireEvent.change(screen.getByLabelText("Customer address"), { target: { value: "Previous customer's address" } });
  await selectRecentCustomer();
  expect(screen.getByLabelText("Customer address")).toHaveValue("");
  expect(screen.getByText(/Confirm and enter the customer’s current address/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(state.sales).toHaveLength(1));
  expect(state.sales[0].draft.customer).toBe("Jamie Taylor");
  expect(state.sales[0].draft.sourceEnquiryId).toBe("");
  expect(state.sales[0].draft.sourceReservationId).toBe("");
});

it("includes customers from prior sales without copying their address, payment ledger or source linkage", async () => {
  const historic = createSaleWorkspace({ draft: {
    id: "prior-draft", customer: "Jamie Taylor", email: "jamie@example.com", phone: "07700900123", address: "Old address",
    vehicleId: "previous-car", vehicle: "Toyota Yaris", registration: "AB12CDE", price: "5000",
    partExchange: false, pxRegistration: "", pxDescription: "", pxValue: "", deposit: "", paymentMethod: "Bank transfer", notes: "", collection: "", preparation: false, documents: false, handover: false,
    sourceEnquiryId: "old-enquiry",
  }, requestId: "prior-sale-request" }, context(), "SALE-PRIOR").sale;
  state.sales = [historic];
  mount();
  await openCustomerStep();
  await selectRecentCustomer();
  expect(screen.getByLabelText("Telephone")).toHaveValue("07700900123");
  expect(screen.getByLabelText("Customer address")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(state.sales).toHaveLength(2));
  const current = state.sales.find(sale => sale.id !== historic.id)!;
  expect(current.draft.sourceEnquiryId).toBe("");
  expect(current.draft.vehicleId).toBe("car-test");
  expect(current.payments).toEqual([]);
  expect(historic.draft.address).toBe("Old address");
});

it("keeps explicitly linked enquiry prefilling from its URL", async () => {
  state.enquiries = [recentEnquiry()];
  state.search = "?enquiryId=enquiry-recent";
  mount();
  await screen.findByRole('heading',{name:'Review sale details'});
  expect(screen.getByText('Ford Focus')).toBeVisible();
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Jamie Taylor");
  fireEvent.change(screen.getByLabelText("Agreed vehicle price (£)"), { target: { value: '10500' } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm details and open sale" }));
  await waitFor(() => expect(state.sales).toHaveLength(1));
  expect(state.sales[0].draft.sourceEnquiryId).toBe("enquiry-recent");
  expect(state.sales[0].draft.price).toBe("10500");
});

it("keeps paid-sale contact corrections editable while preventing another recent customer being substituted", async () => {
  state.enquiries = [recentEnquiry()];
  mount();
  await details("deposit");
  await pay("500", "deposit", "Cash");
  navigateSection('Deal');openCustomerFields();
  const name = screen.getByLabelText("Customer’s full name");
  expect(name).toBeEnabled();
  fireEvent.change(name, { target: { value: "Jamie" } });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Telephone"), { target: { value: "07700900124" } });
  expect(screen.getByLabelText("Telephone")).toHaveValue("07700900124");
});

it("keeps manual customer entry available when recent enquiries cannot load", async () => {
  state.enquiriesError = true;
  mount();
  await openCustomerStep();
  expect(screen.getByText(/Some recent customer details could not be loaded/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Customer’s full name"), { target: { value: "New Customer" } });
  await advance();
  expect(screen.getByRole("heading", { name: "What would you like to do?" })).toBeInTheDocument();
});


function savedSale(overrides: Partial<SaleWorkspaceRecord["draft"]> = {}) {
  return createSaleWorkspace({ draft: {
    ...emptyDraft(), customer: "Jamie Taylor", email: "jamie@example.com", phone: "07700900123",
    address: "10 Test Road", vehicleId: "car-test", vehicle: "Ford Focus", registration: "AB20XYZ", price: "10000",
    ...overrides,
  }, requestId: `fixture-create-${++serial}` }, context(), "SALE-SAVED").sale;
}
function fixtureCommand(sale: SaleWorkspaceRecord, command: SaleWorkspaceCommand) {
  return changeSaleWorkspace(sale, command, { expectedRevision: sale.revision, requestId: `fixture-command-${++serial}` }, context()).sale;
}
async function completeFinalChecks() {
  expect(screen.getByRole('complementary', { name: 'Before completing the sale' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /^Check:/ })).not.toBeInTheDocument();
}
function fixturePayment(sale: SaleWorkspaceRecord, amount: string, kind: "deposit" | "part-payment" | "final-payment" = "deposit") {
  return fixtureCommand(sale, { action: "invoice-payment", payment: {
    amount, kind, status: "confirmed", method: "Bank transfer", date: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }), reference: "fixture payment",
  } });
}
async function mountSaved(sale: SaleWorkspaceRecord) {
  state.sales = [sale];
  state.search = `?saleId=${sale.id}`;
  mount();
  // This fixture intentionally exercises query loading followed by the URL's
  // saved-sale effect. Give both React commits time under the parallel suite;
  // still require the actual summary before any workflow assertions begin.
  await screen.findByRole('heading',{name:/What would you like to do\?|Choose the customer/});
}
function mutations() { return state.fetch.mock.calls.filter(([, options]) => options?.method); }

it('keeps requested deposit separate from receipt, then issues the deposit invoice without manual AI approval',async()=>{
 await mountSaved(savedSale());
 fireEvent.click(within(screen.getByLabelText('Choose what to do')).getByRole('button',{name:/^Request a deposit/}));
 fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'200'}});
 fireEvent.click(screen.getByRole('button',{name:'Request £200.00'}));
 await waitFor(()=>expect(state.sales[0].paymentRequests).toHaveLength(1));
 expect(state.sales[0].payments).toEqual([]);expect(state.sales[0].lifecycle).toBeUndefined();
 expect(state.stock.cars[0].inventoryStatus).toBe('available');
 await pay('200','deposit','Bank transfer');
 expect(state.sales[0].lifecycle?.status).toBe('reserved');
 await issue('deposit');
 expect(state.sales[0].documents.at(-1)?.invoiceKind).toBe('deposit');
 expect(state.sales[0].documents.at(-1)?.snapshot.totals.balance).toBe(980000);
 expect(screen.queryByRole('button',{name:'Run final checks'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Override AI/})).not.toBeInTheDocument();
 expect(mutations().some(([url])=>/final-review|override-final-review/.test(String(url)))).toBe(false);
});

it('takes a return from the original saved sale and keeps its customer and payment history',async()=>{
 let original=fixturePayment(savedSale({customer:'Original Buyer'}),'10000','final-payment');
 original=fixtureCommand(original,{action:'issue-invoice',kind:'full',acknowledge:true});
 original=fixtureCommand(original,{action:'finish-invoice-sale',acknowledge:true});
 const before=structuredClone(original);
 await mountSaved(original);
 fireEvent.click(screen.getByRole('button',{name:/^Return or change a car/}));
 fireEvent.click(screen.getByRole('button',{name:/^Return car/}));
 expect(screen.getByRole('region',{name:'Return car'})).toHaveTextContent('£10,000.00');
 expect(document.querySelector('.sales-flow-context')).toHaveTextContent('Original Buyer');
 expect(state.sales[0]).toEqual(before);expect(mutations()).toHaveLength(0);
});

it('enters a separate copied-stock practice workspace without creating a live draft or sending a message',async()=>{
 mount();
 fireEvent.keyDown(await screen.findByRole('button',{name:'Quick actions'}), {key:'Enter'});
 fireEvent.click(await screen.findByRole('menuitem',{name:'Try with a real car'}));
 expect(screen.getAllByText('TEST ONLY').length).toBeGreaterThanOrEqual(2);
 chooseStockVehicle('car-test');fireEvent.click(screen.getByRole('button',{name:'Customer details'}));
 expect(screen.getByLabelText('Full name')).toHaveValue('Alex Example');
 expect(mutations()).toHaveLength(0);expect(state.sales).toEqual([]);
 expect(state.stock.cars[0].inventoryStatus).toBe('available');
});

it("opens a saved sale at its useful summary and resumes payments without repeating vehicle and customer questions", async () => {
  const sale = fixturePayment(savedSale(), "500");
  await mountSaved(sale);
  const summary = document.body;
  expect(summary).toHaveTextContent("Ford Focus");
  expect(summary).toHaveTextContent("Jamie Taylor");
  expect(document.body).toHaveTextContent('SALE-SAVED');
  expect(document.body).toHaveTextContent("Reserved");
  expect(summary).toHaveTextContent("£10,000.00");
  expect(summary).toHaveTextContent("£500.00");
  expect(summary).toHaveTextContent("£9,500.00");
  expect(screen.queryByRole("navigation", { name: "Invoice steps" })).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox", { name: "Search stock vehicles" })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
  openPayments();
  expect(screen.getByRole("heading", { name: "Take a payment" })).toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), { target: { value: "9500.01" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I have checked that this money/ }));
  expect(screen.getByRole("button", { name:/^Save (?:£[\d,.]+ )?(?:deposit|payment)$/ })).toBeDisabled();
});

it('opens an incomplete saved customer directly and prevents issuing incomplete paperwork', async()=>{
 await mountSaved(savedSale({customer:''}));expect(screen.getByLabelText('Customer’s full name')).toHaveValue('');
 fireEvent.click(screen.getAllByRole('button',{name:'Choose what to do'}).find(button=>!button.closest('nav'))!);
 expect(screen.getByRole('alert')).toHaveTextContent('Enter the customer name');
 expect(screen.queryByRole('button',{name:/^Create an invoice/})).not.toBeInTheDocument();expect(mutations()).toHaveLength(0);
});

it("keeps the saved car details visible when that car is no longer in the current stock feed", async () => {
  state.stock.cars = [];
  await mountSaved(savedSale({ price: "9750" }));
  navigateSection('Deal');openCustomerFields();
  const car = saleSummary();
  expect(car).toHaveTextContent("Ford Focus");
  expect(car).toHaveTextContent(/AB20\s*XYZ/);
  expect(car).toHaveTextContent("£9,750.00");
  expect(within(car).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Car" })).toBeEnabled();
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Jamie Taylor");
  expect(mutations()).toHaveLength(0);
});

it('does not let the vehicle tab bypass a paid reservation’s vehicle lock', async()=>{
 await mountSaved(fixturePayment(savedSale(),'500'));fireEvent.click(screen.getByRole('button',{name:'Car'}));
 expect(screen.getByRole('button',{name:'Change vehicle'})).toBeDisabled();expect(screen.getByRole('region',{name:'Vehicle selection'})).toHaveTextContent('locked');expect(mutations()).toHaveLength(0);
});

it('resumes invoice creation for a fully paid saved sale without issuing anything automatically', async()=>{
 const sale=fixturePayment(savedSale(),'10000','final-payment');await mountSaved(sale);expect(screen.getByLabelText('Sale amounts')).toHaveTextContent('Left to pay £0.00');
 navigateSection('Invoices');expect(screen.getByRole('button',{name:'Create & save invoice'})).toBeDisabled();expect(mutations()).toHaveLength(0);expect(sale.documents).toHaveLength(0);
});

it("offers the existing completion review for a current full invoice and still requires outstanding-balance acknowledgement", async () => {
  const sale = fixtureCommand(savedSale(), { action: "issue-invoice", kind: "full", acknowledge: true });
  await mountSaved(sale);
  openInvoice();
  expect(screen.getByRole("heading", { name: "Create an invoice" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yes, mark sold & remove" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /I confirm the sale can proceed/ })).not.toBeChecked();
  expect(state.sales[0].completedAt).toBeUndefined();
  expect(mutations()).toHaveLength(0);
});

it('keeps invoice QR hidden while print, download and manual email remain usable',async()=>{
 state.invoiceQrEnabled=false;const sale=fixtureCommand(fixturePayment(savedSale(),'10000','final-payment'),{action:'issue-invoice',kind:'full',acknowledge:true});
 const frozenDocuments=structuredClone(sale.documents),frozenPayments=structuredClone(sale.payments);await mountSaved(sale);openInvoice();
 expect(screen.queryByRole('button',{name:'Use email instead'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Open & print invoice'}));await waitFor(()=>expect(state.pdf).toHaveBeenCalledTimes(1));
 expect(state.pdf.mock.calls[0][0].issuedDocument.id).toBe(sale.documents.at(-1)!.id);expect(state.pdf.mock.calls[0][1]).toBe('print');expect(mutations()).toHaveLength(0);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Download PDF'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Download PDF'}));await waitFor(()=>expect(state.pdf).toHaveBeenCalledTimes(2));expect(state.pdf.mock.calls[1][1]).toBe('download');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Email customer'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Email customer'}));
 expect(mutations()).toHaveLength(0);
 confirmDocumentEmail();
 await screen.findByText('Document emailed to the customer.');
 expect(state.fetch.mock.calls.filter(([url,options])=>options?.method==='POST'&&String(url).endsWith('/email'))).toHaveLength(1);expect(state.fetch.mock.calls.some(([url])=>String(url).includes('/phone-shares'))).toBe(false);expect(state.sales[0].documents).toEqual(frozenDocuments);expect(state.sales[0].payments).toEqual(frozenPayments);
});

it('shows the issued customer and car on an old invoice and blocks email after the sale address is corrected', async () => {
  const issued = fixtureCommand(savedSale({ email: 'old@example.com' }), { action: 'issue-invoice', kind: 'full', acknowledge: true });
  const sale = fixtureCommand(issued, { action: 'update', draft: { ...issued.draft, customer: 'Corrected Buyer', email: 'corrected@example.com', vehicle: 'Updated car details', registration: 'CD22XYZ' } });
  await mountSaved(sale);
  openInvoice();
  const email = screen.getByRole('button', { name: 'Email customer' });
  expect(email).toBeDisabled();
  expect(email).toHaveAccessibleDescription(/customer details have changed.*Create an updated document/i);
  const card = screen.getByText('Email on this copy: old@example.com').closest('.invoice-ready-card');
  expect(card).toHaveTextContent('Jamie Taylor');
  expect(card).toHaveTextContent('Ford Focus · AB20XYZ');
  expect(card).not.toHaveTextContent('Corrected Buyer');
  fireEvent.click(email);
  expect(screen.queryByRole('dialog', { name: 'Email this document?' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(mutations()).toHaveLength(0);
});

it.each(['paused', 'loading', 'error'] as const)('does not offer or submit invoice email while effective availability is %s', async status => {
  state.customerEmails = false;
  state.featuresLoading = status === 'loading';
  state.featuresError = status === 'error';
  const sale = fixtureCommand(savedSale(), { action: 'issue-invoice', kind: 'full', acknowledge: true });
  const snapshot = structuredClone(sale);
  await mountSaved(sale);
  openInvoice();
  const email = screen.getByRole('button', { name: 'Email customer' });
  expect(email).toBeDisabled();
  expect(email).toHaveAccessibleDescription(status === 'loading' ? /Checking email availability/ : status === 'error' ? /Email availability could not be checked/ : /switched off by platform administration/);
  fireEvent.click(email);
  expect(screen.getByRole('button', { name: 'Open & print invoice' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(screen.getByRole('button', {name:'Download PDF'})).toBeEnabled();
  expect(state.fetch.mock.calls.filter(([path, options]) => options?.method === 'POST' && String(path).endsWith('/email'))).toHaveLength(0);
  expect(mutations()).toHaveLength(0);
  expect(state.sales[0]).toEqual(snapshot);
  if (status === 'error') expect(screen.getByRole('button', { name: 'Retry email availability' })).toBeEnabled();
});

it.each(['full','deposit'] as const)('keeps handover arrangements in their own section when opening and emailing a %s invoice', async kind=>{
 let sale=fixturePayment(savedSale({fulfilment:{method:'delivery',viewed:'viewed',address:'25 Test Road',recipient:'Jamie Taylor',phone:'07700900123',scheduledDate:'2026-10-27',timeWindow:'Afternoon',instructions:'',driver:'',stage:'booked'}}),kind==='full'?'10000':'500',kind==='full'?'final-payment':'deposit');
 sale=fixtureCommand(sale,{action:'issue-invoice',kind,acknowledge:true});const docs=structuredClone(sale.documents),payments=structuredClone(sale.payments);await mountSaved(sale);
 navigateSection('Collection & delivery');expect(screen.getAllByRole('region',{name:'Collection and delivery'})).toHaveLength(1);
 openInvoice();expect(screen.queryByRole('region',{name:'Collection and delivery'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Email customer'}));confirmDocumentEmail();await screen.findByText('Document emailed to the customer.');
 navigateSection('Collection & delivery');expect(screen.getAllByRole('region',{name:'Collection and delivery'})).toHaveLength(1);expect(state.sales[0].documents).toEqual(docs);expect(state.sales[0].payments).toEqual(payments);expect(state.pdf).not.toHaveBeenCalled();
});

it('shows reminders and marks a paid car sold without final checklist writes', async () => {
  let sale = fixturePayment(savedSale(), '10000', 'final-payment');
  sale = fixtureCommand(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true });
  const frozenInvoice = structuredClone(sale.documents.at(-1));
  await mountSaved(sale);
  openInvoice();
  await completeFinalChecks();
  const finish = screen.getByRole('button', { name: 'Yes, mark sold & remove' });
  expect(finish).toBeEnabled();
  fireEvent.click(finish);
  await waitFor(() => expect(state.sales[0].lifecycle?.status).toBe('sold'));
  expect(state.sales[0].documents.at(-1)).toEqual(frozenInvoice);
  expect(state.sales[0].checklists).toBeUndefined();
  expect(mutations().filter(([url]) => String(url).endsWith('/checklists'))).toHaveLength(0);
});

it('does not ask for saved part-exchange checks again on the final screen', async () => {
  let sale = fixturePayment(savedSale({ exchanges: [{ registration: 'PX20ABC', description: 'Customer car', value: '1000' }] }), '9000', 'final-payment');
  sale = fixtureCommand(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true });
  sale = fixtureCommand(sale, { action: 'checklists', partExchanges: [{ registration: 'PX20ABC', items: Object.fromEntries(partExchangeChecklistItems.map(item => [item.id, 'checked'])) }] });
  const checks = structuredClone(sale.checklists);
  await mountSaved(sale);
  openInvoice();
  expect(screen.getByRole('button', { name: 'Yes, mark sold & remove' })).toBeEnabled();
  expect(screen.getByText(/No need to complete them again/)).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /^Check:/ })).not.toBeInTheDocument();
  expect(state.sales[0].checklists).toEqual(checks);
  expect(mutations()).toHaveLength(0);
});

it('takes unfinished intake checks back to Payments rather than duplicating them', async () => {
  let sale = fixturePayment(savedSale({ exchanges: [{ registration: 'PX20ABC', description: 'Customer car', value: '1000' }] }), '9000', 'final-payment');
  sale = fixtureCommand(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true });
  await mountSaved(sale);
  openInvoice();
  expect(screen.getByRole('button', { name: 'Yes, mark sold & remove' })).toBeDisabled();
  expect(screen.queryByRole('checkbox', { name: /^Check:/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review part-exchange checks' }));
  expect(screen.getByRole('heading', { name: 'Extras and part exchange' })).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox', { name: /^Check:/ })).toHaveLength(5);
});

it('retains an earlier frozen invoice after later payments and offers another document deliberately',async()=>{
 let sale=fixtureCommand(savedSale(),{action:'issue-invoice',kind:'full',acknowledge:true});const issued=structuredClone(sale.documents.at(-1));sale=fixturePayment(sale,'10000','final-payment');await mountSaved(sale);
 navigateSection('Invoices');expect(screen.getByRole('button',{name:'Create & save invoice'})).toBeDisabled();expect(sale.documents.find(doc=>doc.id===issued!.id)).toEqual(issued);expect(state.sales[0].completedAt).toBeUndefined();expect(mutations()).toHaveLength(0);
});

it('opens a completed sale’s frozen invoice and keeps completed customer and vehicle details locked',async()=>{
 let sale=fixturePayment(savedSale(),'10000','final-payment');sale=fixtureCommand(sale,{action:'issue-invoice',kind:'full',acknowledge:true});sale=fixtureCommand(sale,{action:'finish-invoice-sale',acknowledge:true});
 const snapshot=structuredClone(sale);await mountSaved(sale);openInvoice();fireEvent.click(screen.getByRole('button',{name:'Open & print invoice'}));await waitFor(()=>expect(state.pdf).toHaveBeenCalledOnce());expect(state.pdf.mock.calls[0][0].issuedDocument).toEqual(sale.documents.at(-1));expect(state.sales[0]).toEqual(snapshot);expect(mutations()).toHaveLength(0);
 navigateSection('Deal');fireEvent.click(screen.getByRole('button',{name:'Car'}));expect(screen.getByLabelText('Agreed vehicle price (£)')).toBeDisabled();expect(screen.getByRole('button',{name:'Change vehicle'})).toBeDisabled();
 openCustomerFields();expect(screen.getByLabelText('Customer’s full name')).toBeDisabled();expect(screen.getByLabelText('Customer address')).toBeDisabled();
});

it.each(['collection','delivery'] as const)('retains the saved full invoice after %s without rewriting documents or payments',async method=>{
 let sale=fixturePayment(savedSale({fulfilment:{method,viewed:'viewed',address:method==='delivery'?'25 Test Road':'',recipient:'Jamie Taylor',phone:'07700900123',scheduledDate:'2026-10-27',timeWindow:'Afternoon',instructions:''}}),'10000','final-payment');
 sale=fixtureCommand(sale,{action:'issue-invoice',kind:'full',acknowledge:true});const issued=structuredClone(sale.documents.at(-1)),payments=structuredClone(sale.payments);sale=fixtureCommand(sale,{action:'finish-invoice-sale',acknowledge:true});sale=fixtureCommand(sale,{action:'handover',recipient:'Jamie Taylor'});const snapshot=structuredClone(sale);await mountSaved(sale);openInvoice();
 fireEvent.click(screen.getByRole('button',{name:'Open & print invoice'}));await waitFor(()=>expect(state.pdf).toHaveBeenCalledOnce());expect(state.pdf.mock.calls[0][0].issuedDocument).toEqual(issued);expect(state.sales[0].documents.find(doc=>doc.id===issued!.id)).toEqual(issued);expect(state.sales[0].payments).toEqual(payments);expect(state.sales[0]).toEqual(snapshot);expect(mutations()).toHaveLength(0);
});

it('preserves an unrecorded payment while switching sections',async()=>{
 await mountSaved(fixturePayment(savedSale(),'500'));openPayments();fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'250'}});navigateSection('Deal');
 await advance();await advance();
 openPayments();expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('250');expect(mutations()).toHaveLength(0);
});

it('does not let saved invoice shortcuts bypass an unrecorded payment',async()=>{
 const sale=fixtureCommand(savedSale(),{action:'issue-invoice',kind:'full',acknowledge:true});await mountSaved(sale);openPayments();fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'250'}});openInvoice();
 expect(screen.getByRole('button',{name:'Yes, mark sold & remove'})).toBeDisabled();expect(mutations()).toHaveLength(0);expect(state.sales[0].completedAt).toBeUndefined();
 navigateSection('Payments');expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('250');
});

it('shows every interim payment with its amount and status in Payments',async()=>{
 let sale=fixturePayment(savedSale(),'500','deposit');sale=fixturePayment(sale,'250','part-payment');await mountSaved(sale);openActions();fireEvent.click(screen.getByRole('button',{name:'Payments and documents'}));
 const history=document.querySelector('.invoice-payment-list') as HTMLElement;expect(history.children).toHaveLength(2);expect(history).toHaveTextContent('£500.00');expect(history).toHaveTextContent('£250.00');expect(history).toHaveTextContent('confirmed');expect(saleSummary()).toHaveTextContent('£9,250.00');expect(mutations()).toHaveLength(0);
});

it("starts a new unsaved sale from Cars using the selected available vehicle and no prior customer", async () => {
  state.sales = [savedSale({ customer: "Existing buyer", email: "existing@example.com" })];
  mount({ embedded: true, newSaleRequest: 1, newSaleVehicleId: "car-test" });
  await openCarScreen();
  expect(screen.getByRole("region", { name: "Vehicle selection" })).toHaveTextContent("Ford Focus selected");
  expect(screen.getByLabelText("Registration / number plate")).toHaveValue("AB20 XYZ");
  expect(screen.getByLabelText("Agreed vehicle price (£)")).toHaveValue("10000");
  await advance();
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("");
  expect(screen.getByLabelText("Telephone")).toHaveValue("");
  expect(mutations()).toHaveLength(0);
  expect(state.sales[0].draft.customer).toBe("Existing buyer");
});

it.each(["reserved", "sold", "archived", "missing"])("refuses a stale Cars start-sale request for a %s vehicle", async inventoryStatus => {
  state.stock.cars[0].inventoryStatus = inventoryStatus;
  mount({ embedded: true, newSaleRequest: 1, newSaleVehicleId: "car-test" });
  expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
  expect(screen.queryByRole("heading", { name: "Choose a car" })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it("keeps the stock failure visible rather than creating a sale for an unverified Cars selection", async () => {
  state.stockError = "Stock unavailable";
  mount({ embedded: true, newSaleRequest: 1, newSaleVehicleId: "car-test" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Refresh Cars before starting this sale");
  expect(screen.queryByRole("heading", { name: "Choose a car" })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

it("retains the selected car and agreed price protection after a deposit reserves the sale", async () => {
  const sale = fixturePayment(savedSale(), "500");
  await mountSaved(sale);
  navigateSection('Deal');fireEvent.click(screen.getByRole("button", { name: "Car" }));
  expect(screen.getByRole("searchbox", { name: "Search stock vehicles" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Change vehicle" })).toBeDisabled();
  expect(screen.getByRole("region", { name: "Vehicle selection" })).toHaveTextContent("locked to this reserved or completed sale");
  expect(state.sales[0]).toEqual(sale);
  expect(mutations()).toHaveLength(0);
});

it("keeps unsaved customer details when a Cars start-sale request is cancelled", async () => {
  state.stock.cars.push({ ...state.stock.cars[0], id: "car-second", title: "Toyota Yaris", make: "Toyota", model: "Yaris", price: 7500 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (newSaleRequest: number) => <QueryClientProvider client={client}><SalesWorkspace embedded newSaleRequest={newSaleRequest} newSaleVehicleId="car-second" /></QueryClientProvider>;
  const view = render(ui(0));
  await openCustomerStep();
  fireEvent.change(screen.getByLabelText("Customer’s full name"), { target: { value: "Unsaved buyer" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    view.rerender(ui(1));
    expect(confirm).toHaveBeenCalledWith("Leave your unsaved invoice details?");
    expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Unsaved buyer");
    expect(saleSummary()).toHaveTextContent("Ford Focus");
    expect(mutations()).toHaveLength(0);
  } finally { confirm.mockRestore(); }
});

it("waits for stock before prefilling a Cars start-sale request", async () => {
  state.stockLoading = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => <QueryClientProvider client={client}><SalesWorkspace embedded newSaleRequest={1} newSaleVehicleId="car-test" /></QueryClientProvider>;
  const view = render(ui());
  expect(screen.queryByRole("heading", { name: "Choose a car" })).not.toBeInTheDocument();
  state.stockLoading = false;
  view.rerender(ui());
  await openCarScreen();
  expect(screen.getByLabelText("Agreed vehicle price (£)")).toHaveValue("10000");
  expect(mutations()).toHaveLength(0);
});

it("offers available stock for a new sale while excluding reserved and unavailable alternatives", async () => {
  for (const [id, inventoryStatus] of [["car-reserved", "reserved"], ["car-sold", "sold"], ["car-archived", "archived"], ["car-hidden", "hidden"], ["car-unavailable", "unavailable"], ["car-withdrawn", "withdrawn"]]) {
    state.stock.cars.push({ ...state.stock.cars[0], id, title: `Ford ${id}`, model: id, inventoryStatus });
  }
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /New sale/ }));
  const options = screen.getByLabelText("Matching stock vehicles");
  expect(within(options).getAllByRole("button")).toHaveLength(1);
  expect(options).toHaveTextContent("Ford Focus");
  expect(options).not.toHaveTextContent("Ford car-reserved");
  expect(options).not.toHaveTextContent("Ford car-sold");
  expect(options).not.toHaveTextContent("Ford car-archived");
  expect(options).not.toHaveTextContent("Ford car-hidden");
  expect(options).not.toHaveTextContent("Ford car-unavailable");
  expect(options).not.toHaveTextContent("Ford car-withdrawn");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search stock vehicles" }), { target: { value: "Blue Manual" } });
  expect(screen.getByLabelText("Agreed vehicle price (£)")).toHaveValue("");
  expect(mutations()).toHaveLength(0);
});

it('resumes a pending short deposit from the next step, confirms the existing payment once and offers its receipt', async () => {
  let sale = savedSale({ email: 'buyer@example.invalid' });
  sale = requestSalePayment(sale, { kind: 'deposit', amount: '500', dueDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }), note: '' }, context()).sale;
  const request = sale.paymentRequests![0];
  sale = fixtureCommand(sale, { action: 'payment', payment: { amount: '400', kind: 'deposit', status: 'pending', method: 'Bank transfer', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }), reference: 'pending-test', paymentRequestId: request.id } });
  const paymentId = sale.payments[0].id;
  await mountSaved(sale);
  expect(saleWorkspaceTotals(state.sales[0].draft, state.sales[0].payments)).toMatchObject({ confirmedPaid: 0, pending: 40000, balance: 1000000 });
  fireEvent.click(screen.getByRole('button', { name: 'Check payments' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm received' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirm deposit received' });
  expect(dialog).toHaveTextContent('£100.00 less than the £500.00 requested');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /I confirm £400.00 has arrived/ }));
  fireEvent.submit(dialog.querySelector('form')!);
  expect(mutations()).toHaveLength(0);
  expect(state.sales[0].lifecycle).toBeUndefined();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Accept £400.00 as the deposit.' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm deposit & reserve car' }));
  await screen.findByRole('button', { name: 'Send deposit confirmation' });
  const requests = mutations();
  expect(requests).toHaveLength(1);
  expect(requests[0][0]).toBe(`/api/sale-workspace/${sale.id}/payments/${paymentId}/confirm`);
  expect(JSON.parse(requests[0][1].body)).toMatchObject({ expectedRevision: sale.revision, reserveVehicle: true, reserveConfirmed: true, acceptShortfall: true });
  expect(state.sales[0].payments).toHaveLength(1);
  expect(state.sales[0].payments[0]).toMatchObject({ id: paymentId, status: 'confirmed', amountPence: 40000 });
  expect(state.sales[0].paymentRequests![0]).toMatchObject({ status: 'accepted', acceptedAmountPence: 40000 });
  expect(state.sales[0].lifecycle?.status).toBe('reserved');
  expect(saleWorkspaceTotals(state.sales[0].draft, state.sales[0].payments)).toMatchObject({ confirmedPaid: 40000, pending: 0, balance: 960000 });
  expect(state.sales[0].documents.find(document => document.id === state.sales[0].payments[0].receiptId)).toMatchObject({ type: 'receipt', paymentAmountPence: 40000 });
  expect(state.pdf).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('confirms a short deposit explicitly, reserves only after confirmation and offers the actual receipt', async () => {
 let sale = savedSale({email:'buyer@example.invalid'});
 sale = requestSalePayment(sale,{kind:'deposit',amount:'500',dueDate:new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'}),note:''},context()).sale;
 sale.paymentRequests![0].sharedAt=context().now;
 await mountSaved(sale);
 expect(screen.queryByLabelText('Live document preview')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Record the deposit'}));
 expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('500.00');
 fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'400'}});
 expect(screen.getByText(/This is £100.00 less than requested/)).toBeVisible();
 fireEvent.click(screen.getByRole('checkbox',{name:/I have checked that this money/}));
 fireEvent.click(screen.getByRole('button',{name:'Save £400.00 deposit'}));
 const dialog=screen.getByRole('dialog');
 expect(dialog).toHaveTextContent('remove it from available stock');
 expect(state.sales[0].payments).toHaveLength(0);
 fireEvent.click(within(dialog).getByRole('button',{name:'Go back'}));
 expect(state.sales[0].lifecycle).toBeUndefined();
 fireEvent.click(screen.getByRole('button',{name:'Save £400.00 deposit'}));
 fireEvent.click(screen.getByRole('button',{name:'Confirm £400.00 & reserve car'}));
 await waitFor(()=>expect(state.sales[0].payments).toHaveLength(1));
 expect(state.sales[0].paymentRequests![0]).toMatchObject({status:'accepted',acceptedAmountPence:40000});
 expect(state.sales[0].lifecycle?.status).toBe('reserved');
 expect(screen.getByLabelText('Payment breakdown')).toHaveTextContent('£9,600.00');
 expect(screen.getByRole('button',{name:'Send deposit confirmation'})).toBeVisible();
 expect(mutations().filter(([url])=>String(url).endsWith('/email'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Send deposit confirmation'}));
 confirmDocumentEmail('buyer@example.invalid');
 await screen.findByText('Deposit confirmation emailed to the customer.');
 fireEvent.click(screen.getByRole('button',{name:'Back to sale'}));
 expect(screen.getByRole('button',{name:'Take the next payment'})).toBeVisible();
});

it('keeps the balance and the native deposit action in one phone footer', async () => {
 vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
   matches: query === '(max-width: 760px)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
 })));
 try {
   let sale = savedSale();
   sale = requestSalePayment(sale, {kind:'deposit', amount:'500', dueDate: new Date().toLocaleDateString('en-CA', {timeZone:'Europe/London'}), note:''}, context()).sale;
   sale.paymentRequests![0].sharedAt = context().now;
   await mountSaved(sale);
   const footer = screen.getByRole('contentinfo', {name:'Sale summary and actions'});
   const balance = within(footer).getByRole('button', {name:/Left to pay.*£10,000.00/});
   expect(balance).toHaveAttribute('aria-expanded', 'false');
   expect(screen.queryByRole('region', {name:'Payment breakdown'})).not.toBeInTheDocument();
   fireEvent.click(balance);
   const breakdown = within(footer).getByRole('region', {name:'Payment breakdown'});
   expect(breakdown).toHaveTextContent('Agreed total');
   expect(breakdown).toHaveTextContent('Payments received');
   fireEvent.keyDown(breakdown, {key:'Escape'});
   expect(balance).toHaveFocus();
   expect(balance).toHaveAttribute('aria-expanded', 'false');

   const recordDeposit = screen.getByRole('button', {name:'Record the deposit'});
   expect(footer).toContainElement(recordDeposit);
   fireEvent.click(recordDeposit);
   expect(screen.getByRole('heading', {name:'Take a deposit'})).toHaveFocus();
   const saveDeposit = screen.getByRole('button', {name:'Save £500.00 deposit'}) as HTMLButtonElement;
   expect(footer).toContainElement(saveDeposit);
   expect(saveDeposit.form).toContainElement(screen.getByLabelText('Payment amount (£)'));
   expect(saveDeposit).toBeDisabled();
   fireEvent.click(screen.getByRole('checkbox', {name:/I have checked that this money/}));
   fireEvent.click(saveDeposit);
   const reserve = screen.getByRole('dialog');
   expect(state.sales[0].payments).toHaveLength(0);
   fireEvent.click(within(reserve).getByRole('button', {name:'Go back'}));
   await waitFor(() => expect(saveDeposit).toHaveFocus());
   fireEvent.click(saveDeposit);
   fireEvent.click(screen.getByRole('button', {name:'Confirm £500.00 & reserve car'}));
   await within(footer).findByRole('button', {name:'Send deposit confirmation'});
   expect(within(footer).getByRole('button', {name:/Left to pay.*£9,500.00/})).toBeVisible();
   expect(state.sales[0].lifecycle?.status).toBe('reserved');
   await pay('9500', 'final-payment', 'Bank transfer');
   expect(within(footer).getByRole('button', {name:/Balance settled.*£0.00/})).toBeVisible();
 } finally {
   vi.unstubAllGlobals();
 }
});

it('warns before recording a second payment with the same amount date method and reference', async () => {
 let sale=fixturePayment(savedSale(),'400','part-payment');
 sale.payments[0].reference='';
 await mountSaved(sale);openPayments();
 fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'400'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/I have checked that this money/}));
 fireEvent.click(screen.getByRole('button',{name:'Save £400.00 payment'}));
 expect(screen.getByRole('dialog')).toHaveTextContent('same date, method and reference');
 expect(screen.getByRole('button',{name:'Record separate payment'})).toBeDisabled();
 expect(state.sales[0].payments).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Go back'}));
 expect(state.sales[0].payments).toHaveLength(1);
});

it('keeps a linked balance request attached when returning to an unfinished payment', async () => {
 let sale=fixturePayment(savedSale(),'500','deposit');
 sale=requestSalePayment(sale,{kind:'balance',amount:'9500',dueDate:new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'}),note:''},context()).sale;
 sale.paymentRequests![0].sharedAt=context().now;
 await mountSaved(sale);
 fireEvent.click(screen.getByRole('button',{name:'Record the requested payment'}));
 fireEvent.change(screen.getByLabelText('Payment amount (£)'),{target:{value:'500'}});
 fireEvent.click(screen.getAllByRole('button',{name:'All actions'})[0]);
 fireEvent.click(within(screen.getByLabelText('Choose what to do')).getByRole('button',{name:/^Request a deposit/}));
 fireEvent.click(screen.getByRole('button',{name:'Return to unfinished payment'}));
 fireEvent.click(screen.getByRole('checkbox',{name:/I have checked that this money/}));
 fireEvent.click(screen.getByRole('button',{name:'Save £500.00 payment'}));
 await waitFor(()=>expect(state.sales[0].payments).toHaveLength(2));
 expect(state.sales[0].payments[1].paymentRequestId).toBe(sale.paymentRequests![0].id);
 expect(state.sales[0].payments[1].kind).toBe('part-payment');
});
