import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry, StaffOnlineReservation } from "@workspace/api-client-react";
import {
  changeSaleWorkspace,
  createSaleWorkspace,
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
        heroImage: null,
      },
    ],
  },
}));
vi.mock("@/lib/stock-context", () => ({
  useStock: () => ({ stock: state.stock }),
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
vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
  useSearch: () => state.search,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  HttpApiError: class extends Error {},
  getGetStockQueryKey: () => ["stock"],
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  useGetEnquiries: () => ({ data: state.enquiries, isError: state.enquiriesError }),
  useListReservations: () => ({ data: { reservations: state.reservations } }),
}));
vi.mock("@/components/sales-demo/sales-document", () => ({
  openSaleDocumentPdf: (...args: unknown[]) => state.pdf(...args),
}));
import { SalesWorkspace } from "./sales-demo";
import { emptyDraft } from "@/components/sales-demo/model";
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
  state.pdf.mockReset();
  serial = 0;
  state.fetch
    .mockReset()
    .mockImplementation(
      async (url: string, options?: { method: string; body: string }) => {
        if (!options) return { sales: state.sales };
        const payload = JSON.parse(options.body);
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
        const action =
          options.method === "PUT"
            ? { action: "update", draft: payload.draft }
            : url.endsWith("/invoice-payments")
              ? { action: "invoice-payment", payment: payload.payment }
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
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SalesWorkspace />
    </QueryClientProvider>,
  );
}
async function details(_type: "deposit" | "full") {
  fireEvent.click(await screen.findByRole("button", { name: /New invoice/ }));
  expect(
    screen.getByRole("heading", { name: "Which car are you selling?" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Customer’s full name"),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Vehicle" }), {
    target: { value: "car-test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.getByRole("heading", { name: "Who is buying the car?" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Customer’s full name"), {
    target: { value: "Jamie Taylor" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
async function pay(
  amount: string,
  kind: "deposit" | "part-payment" | "final-payment",
  method: string,
) {
  fireEvent.change(screen.getByLabelText("Payment type"), {
    target: { value: kind },
  });
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByLabelText("Payment method"), {
    target: { value: method },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I have checked that this money/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save payment" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled(),
  );
}
async function issue(type: "deposit" | "full") {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.getByRole("heading", { name: "Which invoice do you need?" }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: type === "deposit" ? /^Deposit invoice/ : /^Full invoice/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I have checked the customer/ }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name:
        type === "deposit" ? "Create deposit invoice" : "Create full invoice",
    }),
  );
  await screen.findByRole("heading", { name: "Your invoice is ready." });
}
it("creates deposit and full invoices with interim payments, and asks before marking the car sold", async () => {
  mount();
  await details("deposit");
  expect(
    screen.queryByText(/Live invoice|Invoice preview|Collection & delivery/),
  ).not.toBeInTheDocument();
  expect(state.pdf).not.toHaveBeenCalled();
  await pay("500", "deposit", "Cash");
  await issue("deposit");
  expect(state.sales[0].lifecycle?.status).toBe("reserved");
  expect(state.sales[0].documents).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Return to this sale" }));
  await pay("1000", "part-payment", "Bank transfer");
  await pay("8500", "final-payment", "Debit card");
  await issue("full");
  expect(state.sales[0].documents).toHaveLength(2);
  expect(state.sales[0].documents[1].snapshot.payments).toHaveLength(3);
  expect(state.sales[0].lifecycle?.status).toBe("reserved");
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
it("blocks overpayments and prevents creating an invoice for an unreceived deposit", async () => {
  mount();
  await details("deposit");
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), {
    target: { value: "10001" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I have checked that this money/ }),
  );
  expect(screen.getByRole("button", { name: "Save payment" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: /^Deposit invoice/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.getByText(
      "Record the received deposit before creating its invoice.",
    ),
  ).toBeInTheDocument();
  expect(state.sales).toHaveLength(0);
});

it("does not silently drop a typed but unrecorded payment when staff continue", async () => {
  mount();
  await details("full");
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), {
    target: { value: "500" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Save this payment first",
  );
  expect(
    screen.getByRole("heading", { name: "What has the customer paid?" }),
  ).toBeInTheDocument();
  expect(state.sales).toHaveLength(0);
});

it("supports an explicitly agreed sale with a balance due and records the later final payment", async () => {
  mount();
  await details("full");
  await issue("full");
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

it("requires the car and customer before asking about payments or invoices", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /New invoice/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select a vehicle");
  expect(
    screen.queryByRole("button", { name: /^Full invoice/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Vehicle" }), {
    target: { value: "car-test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter the customer name",
  );
  expect(state.sales).toHaveLength(0);
});
it("calculates a fee, discount and part exchange exactly before issuing the full invoice", async () => {
  mount();
  await details("full");
  fireEvent.click(screen.getByText("Fees, discounts or part exchange"));
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
  fireEvent.click(await screen.findByRole("button", { name: /New invoice/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Vehicle" }), {
    target: { value: "car-test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
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
  expect(state.fetch.mock.calls.filter(([, options]) => options)).toHaveLength(0);
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
  await screen.findByRole("heading", { name: "Which car are you selling?" });
  expect(screen.getByRole("combobox", { name: "Vehicle" })).toHaveValue("car-test");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("Jamie Taylor");
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await waitFor(() => expect(state.sales).toHaveLength(1));
  expect(state.sales[0].draft.sourceEnquiryId).toBe("enquiry-recent");
});

it("keeps paid-sale contact corrections editable while preventing another recent customer being substituted", async () => {
  state.enquiries = [recentEnquiry()];
  mount();
  await details("deposit");
  await pay("500", "deposit", "Cash");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("heading", { name: "What has the customer paid?" })).toBeInTheDocument();
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
function fixturePayment(sale: SaleWorkspaceRecord, amount: string, kind: "deposit" | "final-payment" = "deposit") {
  return fixtureCommand(sale, { action: "invoice-payment", payment: {
    amount, kind, status: "confirmed", method: "Bank transfer", date: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }), reference: "fixture payment",
  } });
}
async function mountSaved(sale: SaleWorkspaceRecord) {
  state.sales = [sale];
  state.search = `?saleId=${sale.id}`;
  mount();
  await screen.findByRole("heading", { name: "Sale summary" });
}
function mutations() { return state.fetch.mock.calls.filter(([, options]) => options); }

it("opens a saved sale at its useful summary and resumes payments without repeating vehicle and customer questions", async () => {
  const sale = fixturePayment(savedSale(), "500");
  await mountSaved(sale);
  const summary = screen.getByRole("region", { name: "Saved sale summary" });
  expect(summary).toHaveTextContent("Ford Focus");
  expect(summary).toHaveTextContent("Jamie Taylor");
  expect(document.body).not.toHaveTextContent('SALE-SAVED');
  expect(summary).toHaveTextContent("Reserved");
  expect(summary).toHaveTextContent("£10,000.00");
  expect(summary).toHaveTextContent("£500.00");
  expect(summary).toHaveTextContent("£9,500.00");
  expect(screen.queryByRole("navigation", { name: "Invoice steps" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Vehicle" })).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Record a payment" }));
  expect(screen.getByRole("heading", { name: "What has the customer paid?" })).toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), { target: { value: "9500.01" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I have checked that this money/ }));
  expect(screen.getByRole("button", { name: "Save payment" })).toBeDisabled();
});

it("takes an incomplete saved customer straight to their details and still guards payment shortcuts", async () => {
  await mountSaved(savedSale({ customer: "" }));
  expect(screen.getByRole("button", { name: "Add customer details" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Manage payments" }));
  expect(screen.getByRole("heading", { name: "Who is buying the car?" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Enter the customer name");
  expect(screen.getByLabelText("Customer’s full name")).toHaveValue("");
  expect(mutations()).toHaveLength(0);
});

it("resumes invoice creation for a fully paid saved sale without issuing anything automatically", async () => {
  const sale = fixturePayment(savedSale(), "10000", "final-payment");
  await mountSaved(sale);
  expect(screen.getByRole("button", { name: "Create invoice" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Saved sale summary" })).toHaveTextContent("Still to pay£0.00");
  fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
  expect(screen.getByRole("heading", { name: "Which invoice do you need?" })).toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("button", { name: "Create full invoice" })).toBeDisabled();
  expect(sale.documents.filter(document => document.type === "invoice")).toHaveLength(0);
});

it("offers the existing completion review for a current full invoice and still requires outstanding-balance acknowledgement", async () => {
  const sale = fixtureCommand(savedSale(), { action: "issue-invoice", kind: "full", acknowledge: true });
  await mountSaved(sale);
  fireEvent.click(screen.getByRole("button", { name: "Review sale completion" }));
  expect(screen.getByRole("heading", { name: "Your invoice is ready." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yes, mark sold & remove" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /I confirm the sale can proceed/ })).not.toBeChecked();
  expect(state.sales[0].completedAt).toBeUndefined();
  expect(mutations()).toHaveLength(0);
});

it("requires an updated invoice when later payments made the saved full invoice out of date", async () => {
  let sale = fixtureCommand(savedSale(), { action: "issue-invoice", kind: "full", acknowledge: true });
  const issuedBeforePayment = structuredClone(sale.documents.at(-1));
  sale = fixturePayment(sale, "10000", "final-payment");
  await mountSaved(sale);
  expect(screen.queryByRole("button", { name: "Review sale completion" })).not.toBeInTheDocument();
  expect(screen.getByText(/Changes since issue/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create updated invoice" }));
  expect(screen.getByRole("heading", { name: "Which invoice do you need?" })).toBeInTheDocument();
  expect(sale.documents.find(document => document.id === issuedBeforePayment!.id)).toEqual(issuedBeforePayment);
  expect(state.sales[0].completedAt).toBeUndefined();
  expect(mutations()).toHaveLength(0);
});

it("opens a completed sale's frozen invoice and keeps completed customer and vehicle details locked", async () => {
  let sale = fixturePayment(savedSale(), "10000", "final-payment");
  sale = fixtureCommand(sale, { action: "issue-invoice", kind: "full", acknowledge: true });
  sale = fixtureCommand(sale, { action: "finish-invoice-sale", acknowledge: true });
  const snapshot = structuredClone(sale);
  await mountSaved(sale);
  fireEvent.click(screen.getByRole("button", { name: "Open latest invoice" }));
  await waitFor(() => expect(state.pdf).toHaveBeenCalledTimes(1));
  expect(state.pdf.mock.calls[0][0].issuedDocument).toEqual(sale.documents.at(-1));
  expect(mutations()).toHaveLength(0);
  expect(state.sales[0]).toEqual(snapshot);
  fireEvent.click(screen.getByRole("button", { name: "View vehicle details" }));
  expect(screen.getByRole("combobox", { name: "Vehicle" })).toBeDisabled();
  expect(screen.getByLabelText("Agreed vehicle price (£)")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Sale summary" }));
  fireEvent.click(screen.getByRole("button", { name: "View customer details" }));
  expect(screen.getByLabelText("Customer’s full name")).toBeDisabled();
  expect(screen.getByLabelText("Customer address")).toBeDisabled();
});

it("preserves an unrecorded payment while switching between the summary and the payment form", async () => {
  await mountSaved(fixturePayment(savedSale(), "500"));
  fireEvent.click(screen.getByRole("button", { name: "Record a payment" }));
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), { target: { value: "250" } });
  fireEvent.click(screen.getByRole("button", { name: "Sale summary" }));
  expect(screen.getByRole("status")).toHaveTextContent("Your unsaved entries are still here");
  fireEvent.click(screen.getByRole("button", { name: "Record a payment" }));
  expect(screen.getByLabelText("Payment amount (£)")).toHaveValue("250");
  expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Save this payment first");
});


it("does not let summary invoice shortcuts bypass an unrecorded payment", async () => {
  const sale = fixtureCommand(savedSale(), { action: "issue-invoice", kind: "full", acknowledge: true });
  await mountSaved(sale);
  fireEvent.click(screen.getByRole("button", { name: "Manage payments" }));
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), { target: { value: "250" } });
  fireEvent.click(screen.getByRole("button", { name: "Sale summary" }));
  fireEvent.click(screen.getByRole("button", { name: "Review sale completion" }));
  expect(screen.getByRole("heading", { name: "What has the customer paid?" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Save this payment first");
  expect(screen.getByLabelText("Payment amount (£)")).toHaveValue("250");
  expect(screen.queryByRole("button", { name: "Yes, mark sold & remove" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sale summary" }));
  fireEvent.click(screen.getByRole("button", { name: "Create another invoice" }));
  expect(screen.getByRole("heading", { name: "What has the customer paid?" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Save this payment first");
  expect(mutations()).toHaveLength(0);
  expect(state.sales[0].completedAt).toBeUndefined();
});
