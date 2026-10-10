import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  SaleWorkspaceDocument,
  SaleWorkspacePayment,
} from "@workspace/vehicle-meta";
import { dealerConfig } from "@/config/dealer";
import { emptyDraft } from "./model";
import { SalesDocument } from "./sales-document";

const payment = (
  overrides: Partial<SaleWorkspacePayment> = {},
): SaleWorkspacePayment => ({
  id: "payment-deposit",
  amount: "500",
  amountPence: 50000,
  signedAmountPence: 50000,
  method: "Bank transfer",
  date: "2026-10-04",
  reference: "Deposit reference",
  kind: "deposit",
  status: "confirmed",
  recordedBy: "Showroom staff",
  recordedAt: "2026-10-04T10:30:00Z",
  ...overrides,
});
const document = (
  overrides: Partial<SaleWorkspaceDocument> = {},
): SaleWorkspaceDocument => ({
  id: "document-deposit",
  number: "RCP-000001",
  type: "receipt",
  title: "Deposit receipt",
  issuedAt: "2026-10-04T10:30:00Z",
  issuedBy: "Showroom staff",
  version: 1,
  paymentId: "payment-deposit",
  paymentAmountPence: 50000,
  balanceAtIssue: 1150000,
  snapshot: {
    draft: {
      ...emptyDraft(),
      payments: [],
      id: "SALE-000001",
      customer: "Alex Buyer",
      vehicleId: "car-1",
      vehicle: "Nissan Qashqai",
      registration: "AB12 CDE",
      price: "12000",
      notes: "",
    },
    payments: [payment()],
    totals: {
      price: 1200000,
      allowance: 0,
      adjustments: 0,
      totalDue: 1200000,
      deposit: 50000,
      confirmedPaid: 50000,
      pending: 0,
      balance: 1150000,
    },
    branding: {
      identity: {
        name: "Original Motors",
        logoAsset: "",
        logoText: "Original Motors",
      },
      contact: { phone: "020 1234 5678", email: "" },
      address: { street: "", city: "", region: "", postcode: "" },
      legal: { companyName: "", companyNumber: "", vatNumber: "" },
    },
    vehicle: {
      year: 2016,
      fuel: "Petrol",
      transmission: "Manual",
      mileage: 58000,
    },
  },
  ...overrides,
});

describe("issued sale documents", () => {
  it("prints only the selected confirmed payment with its original balance and document number", () => {
    const doc = document();
    // Additional transactions must never be mistaken for the receipt's individual payment.
    doc.snapshot.payments.push(
      payment({
        id: "payment-later",
        amount: "2000",
        amountPence: 200000,
        signedAmountPence: 200000,
        reference: "Later payment reference",
        kind: "part-payment",
      }),
    );
    render(<SalesDocument issuedDocument={doc} />);
    const receipt = screen.getByRole("region", { name: "Receipt payment" });
    expect(within(receipt).getByText("£500.00")).toBeInTheDocument();
    expect(within(receipt).getByText("Deposit reference")).toBeInTheDocument();
    expect(
      screen.queryByText("Later payment reference"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("£11,500.00")).toBeInTheDocument();
    expect(
      screen.getAllByText("RCP-000001", { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/DEMO|NOT ISSUED|NO PAYMENT RECEIVED/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Payment recorded by staff")).toBeInTheDocument();
    expect(screen.getByText("Issued document")).toBeInTheDocument();
    expect(
      screen.queryByText(/Local record|Local preview/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Issued by showroom staff.")).toBeInTheDocument();
  });

  it("cleans legacy staff attribution labels without rewriting the saved snapshot", () => {
    const doc = document({ issuedBy: "Local preview staff" });
    doc.snapshot.payments[0].recordedBy = "Jamie (preview)";
    doc.snapshot.draft.customer = "Alex (preview)";
    render(<SalesDocument issuedDocument={doc} />);
    expect(screen.getByText("Showroom staff")).toBeInTheDocument();
    expect(screen.getByText("Jamie")).toBeInTheDocument();
    expect(screen.getByText("Alex (preview)")).toBeInTheDocument();
    expect(screen.queryByText("Local preview staff")).not.toBeInTheDocument();
    expect(screen.queryByText("Jamie (preview)")).not.toBeInTheDocument();
    expect(doc.issuedBy).toBe("Local preview staff");
    expect(doc.snapshot.payments[0].recordedBy).toBe("Jamie (preview)");
    expect(doc.snapshot.draft.customer).toBe("Alex (preview)");
  });

  it("uses frozen branding and vehicle facts even when the live sale and settings change", () => {
    const doc = document({
      type: "invoice",
      title: "Sales invoice",
      number: "INV-000001",
      paymentId: undefined,
    });
    render(
      <SalesDocument
        issuedDocument={doc}
        draft={{
          ...emptyDraft(),
          customer: "Changed customer",
          vehicle: "Changed car",
          price: "999",
        }}
        dealer={{ ...dealerConfig, identity: { name: "Changed Motors" } }}
        documentType="Sales invoice"
      />,
    );
    expect(
      screen.getAllByText("Original Motors", { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Alex Buyer")).toBeInTheDocument();
    expect(screen.getAllByText("Nissan Qashqai").length).toBeGreaterThan(0);
    expect(screen.getByText("58,000 miles")).toBeInTheDocument();
    expect(screen.queryByText("Changed customer")).not.toBeInTheDocument();
    expect(screen.queryByText("Changed Motors")).not.toBeInTheDocument();
    expect(screen.queryByText("Changed car")).not.toBeInTheDocument();
  });

  it("separates pending payments from confirmed money on a balance statement", () => {
    const doc = document({
      type: "statement",
      title: "Balance statement",
      number: "STM-000001",
      paymentId: undefined,
    });
    doc.snapshot.payments.push(
      payment({
        id: "payment-pending",
        amount: "2000",
        amountPence: 200000,
        signedAmountPence: 200000,
        reference: "Awaiting transfer",
        status: "pending",
        kind: "part-payment",
      }),
    );
    doc.snapshot.totals.pending = 200000;
    render(<SalesDocument issuedDocument={doc} />);
    const confirmed = screen.getByRole("table", {
      name: "Confirmed payment history",
    });
    expect(within(confirmed).getByText("£500.00")).toBeInTheDocument();
    expect(
      within(confirmed).queryByText("Awaiting transfer"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: "Pending payments" })).getByText(
        "Awaiting transfer",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Pending · not deducted")).toBeInTheDocument();
    expect(screen.getByText("£11,500.00")).toBeInTheDocument();
  });

  it("keeps handover details separate from an outstanding payment balance", () => {
    const doc = document({
      type: "handover",
      title: "Delivery confirmation",
      number: "HND-000001",
      paymentId: undefined,
    });
    doc.snapshot.draft.fulfilment = {
      method: "delivery",
      viewed: "not-yet-viewed",
      address: "12 Delivery Road\nLondon",
      recipient: "Alex Buyer",
      phone: "07700 900123",
      scheduledDate: "2026-10-06",
      timeWindow: "10:00–12:00",
      instructions: "Call on arrival",
      completedAt: "2026-10-06T10:00:00Z",
      completedBy: "Delivery staff",
      completedRecipient: "Alex Buyer",
    };
    render(<SalesDocument issuedDocument={doc} />);
    expect(screen.getByText("Not yet viewed")).toBeInTheDocument();
    expect(
      screen.getByText("12 Delivery Road London", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("Call on arrival")).toBeInTheDocument();
    expect(screen.getByText("£11,500.00")).toBeInTheDocument();
    expect(screen.queryByText("Balance paid in full")).not.toBeInTheDocument();
  });

  it("renders a refund without calling it a received payment", () => {
    const doc = document({
      title: "Refund receipt",
      paymentId: "payment-refund",
      balanceAtIssue: 1200000,
    });
    doc.snapshot.payments.push(
      payment({
        id: "payment-refund",
        kind: "refund",
        signedAmountPence: -50000,
        reason: "Refund agreed",
        reference: "Refund reference",
      }),
    );
    doc.snapshot.totals.confirmedPaid = 0;
    doc.snapshot.totals.balance = 1200000;
    render(<SalesDocument issuedDocument={doc} />);
    expect(screen.getByText("Amount refunded")).toBeInTheDocument();
    expect(screen.getByText("Refund agreed")).toBeInTheDocument();
    expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
    expect(screen.queryByText("Deposit reference")).not.toBeInTheDocument();
  });

  it("identifies a refund correction as restored funds and shows customer credit", () => {
    const doc = document({
      title: "Refund correction receipt",
      paymentId: "refund-correction",
      paymentAmountPence: 100000,
      balanceAtIssue: -100000,
    });
    doc.snapshot.draft.price = "1000";
    doc.snapshot.payments = [
      payment({
        amount: "1000",
        amountPence: 100000,
        signedAmountPence: 100000,
      }),
      payment({
        id: "refund",
        kind: "refund",
        amount: "1000",
        amountPence: 100000,
        signedAmountPence: -100000,
      }),
      payment({
        id: "later-payment",
        kind: "final-payment",
        amount: "1000",
        amountPence: 100000,
        signedAmountPence: 100000,
      }),
      payment({
        id: "refund-correction",
        kind: "refund-correction",
        amount: "1000",
        amountPence: 100000,
        signedAmountPence: 100000,
        reason: "The provider refund failed. No new payment was charged.",
      }),
    ];
    doc.snapshot.totals = {
      price: 100000,
      allowance: 0,
      adjustments: 0,
      totalDue: 100000,
      deposit: 200000,
      confirmedPaid: 200000,
      pending: 0,
      balance: -100000,
    };
    render(<SalesDocument issuedDocument={doc} />);
    expect(screen.getByText("Refund amount restored")).toBeInTheDocument();
    expect(screen.getByText("Customer credit at issue")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The provider refund failed. No new payment was charged.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Payment received")).not.toBeInTheDocument();
  });

  it("does not render unavailable or placeholder vehicle facts", () => {
    const doc = document();
    doc.snapshot.vehicle = {
      year: null,
      fuel: "Unknown",
      transmission: "Not supplied",
      mileage: null,
    };
    doc.snapshot.draft.registration = "Not supplied";
    render(<SalesDocument issuedDocument={doc} />);
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    expect(screen.queryByText("Not supplied")).not.toBeInTheDocument();
    expect(screen.queryByText("Listed mileage")).not.toBeInTheDocument();
    expect(screen.queryByText("Registration")).not.toBeInTheDocument();
  });

  it("does not deny confirmed payments on an unissued shared-sale invoice preview", () => {
    render(
      <SalesDocument
        draft={{
          ...emptyDraft(),
          id: "SALE-000001",
          vehicle: "Nissan Qashqai",
          price: "12000",
          customer: "Alex Buyer",
          payments: [payment()],
        }}
        dealer={dealerConfig}
        documentType="Sales invoice"
      />,
    );
    expect(
      screen.getByText("DRAFT — NOT ISSUED · PAYMENTS RECORDED BY STAFF"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/NO PAYMENT RECEIVED|NO CONFIRMED PAYMENTS/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Draft preview")).toBeInTheDocument();
  });

  it("retains the explicit unissued mode for editable draft previews", () => {
    render(
      <SalesDocument
        draft={{
          ...emptyDraft(),
          vehicle: "Nissan Qashqai",
          price: "12000",
          customer: "Alex Buyer",
        }}
        dealer={dealerConfig}
        documentType="Sales invoice"
      />,
    );
    expect(
      screen.getByText("DRAFT — NOT ISSUED · NO CONFIRMED PAYMENTS"),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft preview")).toBeInTheDocument();
    expect(screen.queryByText("Issued document")).not.toBeInTheDocument();
  });
});

describe("approved agreement documents", () => {
  it("prints the frozen approved wording, identity and signature spaces without invoice wording", () => {
    const doc = document({
      type: "terms",
      title: "Terms and conditions of sale",
      content: "Approved wording supplied by the dealership.",
    });
    render(<SalesDocument issuedDocument={doc} />);
    expect(
      screen.getByText("Approved wording supplied by the dealership."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Customer signature:/)).toBeInTheDocument();
    expect(screen.queryByText(/This invoice records/)).not.toBeInTheDocument();
  });
  it("omits absent vehicle facts instead of inventing them", () => {
    const doc = document({
      type: "vehicle-details",
      title: "Vehicle details and disclosures",
    });
    render(<SalesDocument issuedDocument={doc} />);
    expect(screen.getByText("Supplied vehicle facts")).toBeInTheDocument();
    expect(screen.queryByText(/write off category/i)).not.toBeInTheDocument();
  });
});

it("shows the invoice's frozen terms on staff and customer document views", () => {
  const content = "Nothing in these terms limits your statutory rights.";
  render(<SalesDocument issuedDocument={document({ type: "invoice", title: "Sales invoice", content })} />);
  expect(within(screen.getByRole("region", { name: "Terms of sale" })).getByText(content)).toBeInTheDocument();
});

it("includes editable terms in the draft invoice preview", () => {
  render(<SalesDocument draft={emptyDraft()} dealer={dealerConfig} documentType="Sales invoice" saleTerms="Draft terms for this dealership" />);
  expect(screen.getByRole("region", { name: "Terms of sale" })).toHaveTextContent("Draft terms for this dealership");
});
