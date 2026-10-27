import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaleWorkspacePayment } from "@workspace/vehicle-meta";
import { emptyDraft } from "./model";
import {
  PaymentDialog,
  ReversePaymentDialog,
  SaleFinancialSummary,
  salePaymentState,
  todayLondon,
} from "./sales-controls";

const props = () => ({
  balance: 1200000,
  hasPayments: false,
  busy: false,
  problem: "",
  onClose: vi.fn(),
  onSave: vi.fn(),
});
function enter(amount: string, received = false) {
  fireEvent.change(screen.getByLabelText("Payment amount (£)"), {
    target: { value: amount },
  });
  if (received) fireEvent.click(screen.getByLabelText(/Money received/));
}
const payment = (
  overrides: Partial<SaleWorkspacePayment> = {},
): SaleWorkspacePayment => ({
  id: "payment-one",
  amount: "500.05",
  amountPence: 50005,
  signedAmountPence: 50005,
  method: "Cash",
  date: todayLondon(),
  reference: "",
  kind: "deposit",
  status: "confirmed",
  recordedBy: "Fixture staff",
  recordedAt: new Date().toISOString(),
  ...overrides,
});

describe("simplified received-payment workflow", () => {
  it("starts pending with optional fields collapsed, then clearly previews a received deposit", () => {
    const p = props();
    render(<PaymentDialog {...p} />);
    expect(screen.getByLabelText(/Money received/)).not.toBeChecked();
    expect(
      screen.getByText("Payment reference & type").closest("details"),
    ).not.toHaveAttribute("open");
    enter("500.05", true);
    expect(screen.getByRole("status")).toHaveTextContent("£11,499.95");
    expect(screen.getByRole("status")).toHaveTextContent("car reserved");
    fireEvent.click(
      screen.getByRole("button", { name: "Save & view receipt" }),
    );
    expect(p.onSave).toHaveBeenCalledOnce();
    expect(p.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "500.05",
        kind: "deposit",
        status: "confirmed",
      }),
    );
  });

  it("does not submit overpayment, fractional pennies, or a falsely labelled final payment", () => {
    const p = props();
    render(<PaymentDialog {...p} />);
    for (const amount of ["12000.01", "1.001", "-1", "90071992547409.92"]) {
      enter(amount);
      expect(
        screen.getByRole("button", { name: "Save pending payment" }),
      ).toBeDisabled();
      fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    }
    enter("100");
    fireEvent.click(screen.getByText("Payment reference & type"));
    fireEvent.change(screen.getByLabelText("Payment type"), {
      target: { value: "final-payment" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "must settle the balance",
    );
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("allows an expected future date but requires an actual received date before issuing a receipt", () => {
    const p = props();
    render(<PaymentDialog {...p} />);
    enter("100");
    fireEvent.change(screen.getByLabelText("Payment date"), {
      target: { value: "2099-12-31" },
    });
    expect(
      screen.getByRole("button", { name: "Save pending payment" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/Money received/));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot have a future date",
    );
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(p.onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Payment date"), {
      target: { value: todayLondon() },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(p.onSave).toHaveBeenCalledOnce();
  });

  it("keeps a pending final payment as final and does not promise a reservation when confirming it", () => {
    const p = { ...props(), balance: 50005, hasPayments: true };
    render(
      <PaymentDialog
        {...p}
        pending={payment({ status: "pending", kind: "final-payment" })}
      />,
    );
    expect(screen.getByLabelText("Payment amount (£)")).toHaveAttribute(
      "readonly",
    );
    fireEvent.click(screen.getByLabelText(/Money received/));
    expect(screen.getByRole("status")).toHaveTextContent("£0.00");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Complete the sale separately",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm & view receipt" }),
    );
    expect(p.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "final-payment", amount: "500.05" }),
    );
  });

  it("blocks invalid refund submissions and permits only the refundable remainder", () => {
    const onSave = vi.fn();
    render(
      <ReversePaymentDialog
        payment={payment({ date: "2026-01-01" })}
        availablePence={30004}
        busy={false}
        problem=""
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Fixture refund" },
    });
    fireEvent.change(screen.getByLabelText("Refund method"), { target: { value: "Bank transfer" } });
    fireEvent.change(screen.getByLabelText("Refund date"), { target: { value: "2026-01-05" } });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I confirm the money has already been refunded/));
    fireEvent.change(screen.getByLabelText("Refund / correction amount (£)"), {
      target: { value: "300.05" },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Refund / correction amount (£)"), {
      target: { value: "300.04" },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "300.04", reason: "Fixture refund", date: "2026-01-05", method: "Bank transfer" }),
    );
  });
});

it("shows accurate statuses for legacy allowances, refund corrections and zero-cash deals", () => {
  const draft = {
    ...emptyDraft(),
    price: "1000",
    partExchange: true,
    pxValue: "500",
    pxRegistration: "FIXTURE",
  };
  expect(
    salePaymentState({
      ...draft,
      payments: [
        payment({
          amount: "500",
          amountPence: 50000,
          signedAmountPence: 50000,
        }),
      ],
    }),
  ).toBe("Paid in full");
  expect(
    salePaymentState({
      ...draft,
      payments: [
        payment({
          amount: "600",
          amountPence: 60000,
          signedAmountPence: 60000,
        }),
      ],
    }),
  ).toBe("Customer credit");
  expect(salePaymentState({ ...draft, pxValue: "1000", payments: [] })).toBe(
    "Balance settled",
  );
});

it("offers a compact itemised price breakdown without hiding pending-payment status", () => {
  const draft = {
    ...emptyDraft(),
    price: "1000",
    partExchange: true,
    pxValue: "200",
    pxRegistration: "FIXTURE",
    adjustments: [
      { kind: "fee" as const, description: "Delivery", amount: "50.25" },
      {
        kind: "discount" as const,
        description: "Agreed discount",
        amount: "10.01",
      },
    ],
    payments: [payment({ status: "pending" })],
  };
  render(<SaleFinancialSummary draft={draft} />);
  const summary = screen.getByText("Agreed total to pay").closest("summary")!;
  expect(
    within(summary as HTMLElement).getByText("£840.24"),
  ).toBeInTheDocument();
  fireEvent.click(summary);
  expect(screen.getByText("Delivery")).toBeInTheDocument();
  expect(screen.getByText("-£10.01")).toBeInTheDocument();
  expect(screen.getByText("-£200.00")).toBeInTheDocument();
  expect(screen.getByText(/£500.05 pending/)).toHaveTextContent(
    "has not reduced the balance",
  );
});
