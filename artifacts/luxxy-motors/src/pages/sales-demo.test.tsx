import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  changeSaleWorkspace,
  createSaleWorkspace,
  type SaleWorkspaceRecord,
  type SaleWorkspaceContext,
  type SaleWorkspaceCommand,
} from "@workspace/vehicle-meta";
const state = vi.hoisted(() => ({
  sales: [] as SaleWorkspaceRecord[],
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
  useSearch: () => "",
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  HttpApiError: class extends Error {},
  getGetStockQueryKey: () => ["stock"],
  useGetEnquiries: () => ({ data: [] }),
  useListReservations: () => ({ data: { reservations: [] } }),
}));
vi.mock("@/components/sales-demo/sales-document", () => ({
  openSaleDocumentPdf: (...args: unknown[]) => state.pdf(...args),
}));
import { SalesPaperworkSettings } from "@/components/sales-paperwork-settings";
import { SalesWorkspace } from "./sales-demo";
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
  state.pdf.mockReset();
  serial = 0;
  state.fetch
    .mockReset()
    .mockImplementation(
      async (url: string, options?: { method: string; body: string }) => {
        if (url === '/api/sale-workspace/paperwork') return { saleTerms: '', reservationTerms: '' };
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

it('refreshes seller details and custom terms after saving settings while Sales remains mounted', async () => {
  let paperwork = { revision: 2, saleTerms: 'Original custom terms', reservationTerms: 'Keep deposit terms', invoiceDetails: { name: 'Original seller' } };
  const originalFetch = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: { method: string; body: string }) => {
    if (url === '/api/dealer-settings') return context().branding;
    if (url === '/api/sale-workspace/paperwork' || url === '/api/dealer-integrations/sales-paperwork') {
      if (options?.method === 'PUT') {
        const { expectedRevision, ...next } = JSON.parse(options.body);
        expect(expectedRevision).toBe(2);
        paperwork = { ...next, revision: 3 };
      }
      return structuredClone(paperwork);
    }
    return originalFetch(url, options);
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const view = (settings: boolean) => <QueryClientProvider client={cache}>
    <div hidden={settings}><SalesWorkspace /></div>
    {settings && <SalesPaperworkSettings />}
  </QueryClientProvider>;
  const mounted = render(view(false));
  await details('full');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: /^Full invoice/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Original seller' });
  mounted.rerender(view(true));
  fireEvent.change(await screen.findByLabelText('Dealership name'), { target: { value: 'Updated seller' } });
  fireEvent.change(screen.getByLabelText('Terms and conditions of sale'), { target: { value: 'Updated custom terms' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save document settings' }));
  await screen.findByText('Document settings saved. Existing issued documents keep their original design, reference and terms.');
  mounted.rerender(view(false));
  expect(await screen.findByRole('heading', { name: 'Updated seller' })).toBeInTheDocument();
  expect(screen.getByText('Updated custom terms')).toBeInTheDocument();
  expect(screen.queryByText('Original custom terms')).not.toBeInTheDocument();
  expect(paperwork.reservationTerms).toBe('Keep deposit terms');
  expect(state.sales).toEqual([]);
});
