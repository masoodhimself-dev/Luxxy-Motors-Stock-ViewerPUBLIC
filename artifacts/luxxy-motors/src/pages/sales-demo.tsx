import { SaleVehiclePhoto,saleVehicleChoiceLabel } from '@/components/sales-demo/vehicle-choice';
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import {
  getGetStockQueryKey,
  useGetEnquiries,
  useListReservations,
} from "@workspace/api-client-react";
import {
  saleWorkspaceTotals,
  type SaleWorkspaceRecord,
  type SaleWorkspaceMutation,
  type SaleWorkspaceDocument,
  type SaleWorkspaceDraft,
  type SaleWorkspacePayment,
} from "@workspace/vehicle-meta";
import { useStock } from "@/lib/stock-context";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import {
  vehicleDisplayTitle,
  vehicleRegistration,
} from "@/lib/utils";
import {
  emptyDraft,
  errors,
  saleRequestId,
  pence,
  type SaleDraft,
} from "@/components/sales-demo/model";
import {
  saleMoney,
  todayLondon,
  ReversePaymentDialog,
} from "@/components/sales-demo/sales-controls";
import { openSaleDocumentPdf } from "@/components/sales-demo/sales-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Plus,
  Printer,
  Download,
  Mail,
} from "lucide-react";
import "@/sales-workspace.css";
import "./invoice-builder.css";

export interface SalesWorkspaceProps {
  embedded?: boolean;
  newSaleRequest?: number;
  onExit?: () => void;
}
const questions = [
  "Which car are you selling?",
  "Who is buying the car?",
  "What has the customer paid?",
  "Which invoice do you need?",
  "Are these details correct?",
];
const paymentDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function SalesWorkspace({
  embedded = false,
  newSaleRequest = 0,
  onExit,
}: SalesWorkspaceProps) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { stock } = useStock();
  const { settings } = useDealerSettings();
  const enquiries = useGetEnquiries();
  const reservations = useListReservations();
  const client = useQueryClient();
  const sales = useQuery({
    queryKey: ["sale-workspace"],
    queryFn: () =>
      customFetch<{ sales: SaleWorkspaceRecord[] }>("/api/sale-workspace"),
    retry: false,
  });
  const [record, setRecord] = useState<SaleWorkspaceRecord | null>(null);
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [kind, setKind] = useState<"deposit" | "full">("full");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [issued, setIssued] = useState<SaleWorkspaceDocument | null>(null);
  const [soldChoice, setSoldChoice] = useState(false);
  const [outstandingAccepted, setOutstandingAccepted] = useState(false);
  const [reverse, setReverse] = useState<SaleWorkspacePayment | null>(null);
  const [payment, setPayment] = useState({
    amount: "",
    method: "Bank transfer",
    date: todayLondon(),
    reference: "",
    kind: "part-payment" as "deposit" | "part-payment" | "final-payment",
    received: false,
  });
  const lock = useRef(false);
  const retries = useRef(new Map<string, string>());
  const consumed = useRef("");
  const consumedNew = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const scrollPane = useRef<HTMLElement>(null);
  const detailsDirty = Boolean(
    draft && JSON.stringify(draft) !== JSON.stringify(record?.draft),
  );
  const dirty = detailsDirty || Boolean(payment.amount.trim());
  const rows = record?.payments ?? [];
  const total = draft
    ? saleWorkspaceTotals(draft as SaleWorkspaceDraft, rows)
    : null;
  const vehicle = stock?.cars.find((car) => car.id === draft?.vehicleId);
  const customerOptions = [
    ...(enquiries.data ?? []).map((item) => ({
      key: `Enquiry ${item.reference}`,
      name: item.customerName,
      email: item.email ?? "",
      phone: item.phone ?? "",
      vehicleId: item.vehicleId ?? "",
      sourceEnquiryId: item.id,
      sourceReservationId: "",
    })),
    ...(reservations.data?.reservations ?? []).map((item) => ({
      key: `Reservation ${item.reference}`,
      name: item.customerName,
      email: item.email,
      phone: item.phone,
      vehicleId: item.vehicleId,
      sourceEnquiryId: "",
      sourceReservationId: item.id,
    })),
  ];
  function open(saved?: SaleWorkspaceRecord, initial?: SaleDraft) {
    if (lock.current) return;
    if (dirty && !window.confirm("Leave your unsaved invoice details?")) return;
    setRecord(saved ?? null);
    setDraft(initial ?? (saved ? structuredClone(saved.draft) : emptyDraft()));
    setStep(0);
    setKind(saved?.documents.at(-1)?.invoiceKind ?? "full");
    setPayment({
      amount: "",
      method: "Bank transfer",
      date: todayLondon(),
      reference: "",
      kind: "part-payment",
      received: false,
    });
    setProblem("");
    setMessage("");
    setIssued(null);
    setReviewed(false);
    setSoldChoice(false);
    setOutstandingAccepted(false);
  }
  useEffect(() => {
    if (newSaleRequest > 0 && newSaleRequest !== consumedNew.current) {
      consumedNew.current = newSaleRequest;
      open();
    }
  }, [newSaleRequest]);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (embedded && params.get("section") !== "sales") return;
    const id = params.get("saleId"),
      enquiryId = params.get("enquiryId"),
      reservationId = params.get("reservationId");
    const key = [id, enquiryId, reservationId].join(":");
    if (
      key === "::" ||
      key === consumed.current ||
      sales.isLoading ||
      lock.current
    )
      return;
    const existing = sales.data?.sales.find((sale) =>
      id
        ? sale.id === id
        : enquiryId
          ? sale.draft.sourceEnquiryId === enquiryId
          : sale.draft.sourceReservationId === reservationId,
    );
    if (existing) {
      consumed.current = key;
      open(existing);
      return;
    }
    const source = customerOptions.find((item) =>
      enquiryId
        ? item.sourceEnquiryId === enquiryId
        : reservationId && item.sourceReservationId === reservationId,
    );
    if (source) {
      consumed.current = key;
      const car = stock?.cars.find((c) => c.id === source.vehicleId);
      open(undefined, {
        ...emptyDraft(),
        customer: source.name,
        email: source.email,
        phone: source.phone,
        vehicleId: source.vehicleId,
        vehicle: car ? vehicleDisplayTitle(car) : "",
        registration: car ? vehicleRegistration(car) : "",
        price: car?.price != null ? String(car.price) : "",
        sourceEnquiryId: source.sourceEnquiryId,
        sourceReservationId: source.sourceReservationId,
        customerSource: source.key,
      });
    }
  }, [search, sales.data, enquiries.data, reservations.data, stock]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (draft) {
      if (scrollPane.current) scrollPane.current.scrollTop = 0;
      heading.current?.focus({ preventScroll: true });
    }
  }, [step, Boolean(draft), Boolean(issued)]);
  function update<K extends keyof SaleDraft>(key: K, value: SaleDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setReviewed(false);
    setProblem("");
  }
  function accept(result: SaleWorkspaceMutation) {
    setRecord(result.sale);
    setDraft(result.sale.draft);
    client.setQueryData<{ sales: SaleWorkspaceRecord[] }>(
      ["sale-workspace"],
      (previous) => ({
        sales: [
          result.sale,
          ...(previous?.sales ?? []).filter(
            (item) => item.id !== result.sale.id,
          ),
        ],
      }),
    );
    return result.sale;
  }
  async function request(url: string, method: string, payload: object) {
    const key = JSON.stringify({ url, method, payload });
    const requestId = retries.current.get(key) ?? saleRequestId();
    retries.current.set(key, requestId);
    try {
      const result = await customFetch<SaleWorkspaceMutation>(url, {
        method,
        body: JSON.stringify({ ...payload, requestId }),
      });
      retries.current.delete(key);
      return result;
    } catch (error) {
      if (error instanceof HttpApiError && error.status < 500)
        retries.current.delete(key);
      throw error;
    }
  }
  async function saveInternal() {
    if (!draft) throw new Error("Start an invoice first.");
    if (record && !detailsDirty) return record;
    const editable = { ...draft, payments: [], deposit: "" };
    return accept(
      await request(
        record ? `/api/sale-workspace/${record.id}` : "/api/sale-workspace",
        record ? "PUT" : "POST",
        {
          draft: editable,
          ...(record ? { expectedRevision: record.revision } : {}),
        },
      ),
    );
  }
  async function command(path: string, payload: object) {
    const saved = await saveInternal();
    const result = await request(
      `/api/sale-workspace/${saved.id}${path}`,
      "POST",
      { expectedRevision: saved.revision, ...payload },
    );
    accept(result);
    return result;
  }
  function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem("");
    void operation()
      .catch((error) => {
        const detail =
          error instanceof HttpApiError &&
          error.data &&
          typeof error.data === "object" &&
          "error" in error.data
            ? String(error.data.error)
            : error instanceof Error
              ? error.message
              : "Please try again.";
        setProblem(detail);
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }
  const save = () =>
    run(async () => {
      await saveInternal();
      setMessage("Details saved.");
    });
  function next() {
    if (step === 2 && payment.amount.trim()) {
      setProblem(
        "Save this payment first, or clear its amount to continue without recording it.",
      );
      return;
    }
    if ((step === 0 || step === 1) && draft) {
      const issues = errors(
        {
          ...draft,
          customer: step === 0 ? "Vehicle check" : draft.customer,
          payments: rows,
        },
        record?.draft,
      );
      if (issues.length) {
        setProblem(issues.join(" "));
        return;
      }
    }
    if (
      step === 3 &&
      kind === "deposit" &&
      (!(total!.confirmedPaid > 0) ||
        !rows.some(
          (row) =>
            row.kind === "deposit" &&
            row.status === "confirmed" &&
            row.signedAmountPence > 0,
        ))
    ) {
      setProblem("Record the received deposit before creating its invoice.");
      return;
    }
    setStep(Math.min(4, step + 1));
    setProblem("");
    setReviewed(false);
  }
  function addPayment(event: React.FormEvent) {
    event.preventDefault();
    if (
      !payment.received ||
      !total ||
      !(pence(payment.amount) > 0) ||
      pence(payment.amount) > total.balance
    )
      return;
    run(async () => {
      await command("/invoice-payments", {
        payment: {
          amount: payment.amount,
          method: payment.method,
          date: payment.date,
          reference: payment.reference,
          kind: payment.kind,
          status: "confirmed",
        },
      });
      await client.invalidateQueries({ queryKey: getGetStockQueryKey() });
      setPayment({ ...payment, amount: "", reference: "", received: false });
      setReviewed(false);
      setMessage(
        payment.kind === "deposit"
          ? "Deposit recorded. The car is reserved for this customer."
          : "Payment recorded. The invoice will include its date, method and amount.",
      );
    });
  }
  function generate() {
    run(async () => {
      if (!draft) return;
      const issues = errors({ ...draft, payments: rows }, record?.draft);
      if (issues.length) throw new Error(issues.join(" "));
      const result = await command("/issue-invoice", {
        kind,
        acknowledge: reviewed,
      });
      setIssued(result.document ?? null);
      setSoldChoice(false);
      setOutstandingAccepted(false);
      setMessage("Invoice created and saved.");
    });
  }
  function documentAction(
    doc: SaleWorkspaceDocument,
    action: "print" | "download",
  ) {
    run(async () => {
      if (!record || !draft) return;
      await openSaleDocumentPdf(
        {
          draft,
          dealer: settings,
          issuedDocument: doc,
          pdfUrl: `/api/sale-workspace/${record.id}/documents/${doc.id}/pdf`,
        },
        action,
      );
    });
  }
  function email(doc: SaleWorkspaceDocument) {
    run(async () => {
      const result = await command(`/documents/${doc.id}/email`, {});
      const delivery = result.sale.emailDeliveries
        ?.filter((d) => d.documentId === doc.id)
        .at(-1);
      setMessage(
        delivery?.status === "sent"
          ? "Invoice emailed to the customer."
          : delivery?.status === "prepared"
            ? "Email prepared. Enable Resend in settings to send it."
            : delivery?.error || "Email status updated.",
      );
    });
  }
  function leave() {
    if (
      lock.current ||
      (dirty && !window.confirm("Leave your unsaved invoice details?"))
    )
      return;
    setDraft(null);
    setRecord(null);
    setIssued(null);
    setProblem("");
    if (onExit) onExit();
    else if (!embedded) navigate("/portal?section=sales");
  }
  function field(
    key: "customer" | "phone" | "email" | "registration" | "price",
    label: string,
    type = "text",
  ) {
    return (
      <label>
        {label}
        <Input
          type={type}
          value={draft?.[key] ?? ""}
          onChange={(event) => update(key, event.target.value)}
          disabled={Boolean(record?.completedAt)}
          inputMode={key === "price" ? "decimal" : undefined}
        />
      </label>
    );
  }

  return (
    <div className={`invoice-builder${draft ? " is-editing" : ""}`}>
      <header className="invoice-builder-header">
        <div>
          <span className="invoice-builder-brand">
            {settings.identity.name}
          </span>
          <strong>Sales & invoices</strong>
        </div>
        <div>
          {draft && (
            <Button variant="outline" disabled={busy} onClick={save}>
              Save details
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={
              draft ? leave : () => (onExit ? onExit() : navigate("/portal"))
            }
          >
            <ArrowLeft size={16} />{" "}
            {draft ? "Back to sales" : "Back to workspace"}
          </Button>
        </div>
      </header>
      {!draft ? (
        <main className="invoice-builder-list">
          <div className="invoice-list-heading">
            <div>
              <h1>Simple paperwork. Clear records.</h1>
              <p>
                Create a deposit invoice or a full sales invoice in five short
                steps.
              </p>
            </div>
            <Button onClick={() => open()}>
              <Plus size={17} /> New invoice
            </Button>
          </div>
          <Input
            aria-label="Search sales"
            placeholder="Search customer, car, registration or reference"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {sales.isLoading && <p role="status">Loading sales…</p>}
          {sales.isError && (
            <p role="alert">
              Sales could not be loaded.{" "}
              <Button onClick={() => void sales.refetch()} variant="outline">
                Retry
              </Button>
            </p>
          )}
          <div className="invoice-sale-list">
            {(sales.data?.sales ?? [])
              .filter((sale) =>
                `${sale.reference} ${sale.draft.customer} ${sale.draft.vehicle} ${sale.draft.registration}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((sale) => (
                <button key={sale.id} onClick={() => open(sale)}>
                  <span>
                    <strong>{sale.draft.customer || "Customer to add"}</strong>
                    <small>
                      {sale.draft.vehicle}{" "}
                      {sale.draft.registration &&
                        `· ${sale.draft.registration}`}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {saleMoney(
                        saleWorkspaceTotals(sale.draft, sale.payments).totalDue,
                      )}
                    </strong>
                    <small>
                      {sale.completedAt
                        ? "Sold"
                        : sale.lifecycle?.status === "reserved"
                          ? "Reserved"
                          : "In progress"}{" "}
                      · {sale.reference}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
          </div>
          {!sales.isLoading && !sales.isError && !sales.data?.sales.length && (
            <div className="invoice-empty">
              <FileText size={32} />
              <h2>Your invoices start here</h2>
              <p>
                Choose a customer and car, record the payments, then create the
                paperwork.
              </p>
            </div>
          )}
        </main>
      ) : (
        <>
          {!issued && (
            <nav className="invoice-steps" aria-label="Invoice steps">
              {[
                "Car",
                "Customer",
                "Payments",
                "Invoice type",
                "Review & create",
              ].map((label, index) => (
                <span
                  key={label}
                  aria-current={index === step ? "step" : undefined}
                >
                  <b>{index < step ? <Check size={14} /> : index + 1}</b>
                  {label}
                </span>
              ))}
            </nav>
          )}
          <main ref={scrollPane} className="invoice-builder-scroll">
            <div className="invoice-question-sheet">
              <p className="invoice-builder-kicker">
                {issued ? "Invoice saved" : `Step ${step + 1} of 5`}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {issued ? "Your invoice is ready." : questions[step]}
              </h1>
              {problem && (
                <p role="alert" className="invoice-error">
                  {problem}
                  {/another device|reload/i.test(problem) && record && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        run(async () => {
                          const latest = await customFetch<{
                            sale: SaleWorkspaceRecord;
                          }>(`/api/sale-workspace/${record.id}`);
                          accept({ sale: latest.sale });
                          setMessage("Latest sale loaded.");
                        })
                      }
                    >
                      Reload latest sale
                    </Button>
                  )}
                </p>
              )}
              {message && (
                <p role="status" className="invoice-message">
                  {message}
                </p>
              )}
              {issued ? (
                <>
                  <div className="invoice-ready-card">
                    <FileText size={32} />
                    <div>
                      <h2>{issued.title}</h2>
                      <p>
                        {issued.number} · {draft.customer}
                      </p>
                      <small>
                        {draft.vehicle} · {draft.registration}
                      </small>
                    </div>
                  </div>
                  <div className="invoice-document-actions">
                    <Button
                      disabled={busy}
                      onClick={() => documentAction(issued, "print")}
                    >
                      <Printer size={17} /> Open & print invoice
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => documentAction(issued, "download")}
                    >
                      <Download size={17} /> Download PDF
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !draft.email}
                      onClick={() => email(issued)}
                    >
                      <Mail size={17} /> Email customer
                    </Button>
                  </div>
                  {issued.invoiceKind === "full" &&
                    !record?.completedAt &&
                    !soldChoice && (
                      <section className="invoice-sold-question">
                        <h2>Should this car be marked sold?</h2>
                        <p>
                          Marking it sold removes it from the customer website.
                          Your invoice and payments stay saved.
                        </p>
                        {total!.balance > 0 && (
                          <>
                            <p className="invoice-message">
                              {saleMoney(total!.balance)} is still due. Removing
                              the car does not settle this balance.
                            </p>
                            <label className="invoice-check">
                              <input
                                type="checkbox"
                                checked={outstandingAccepted}
                                onChange={(event) =>
                                  setOutstandingAccepted(event.target.checked)
                                }
                              />
                              I confirm the sale can proceed with this
                              outstanding balance. We will record the remaining
                              payment later.
                            </label>
                          </>
                        )}
                        <div>
                          <Button
                            disabled={
                              busy ||
                              total!.balance < 0 ||
                              (total!.balance > 0 && !outstandingAccepted) ||
                              !draft.vehicleId
                            }
                            onClick={() =>
                              run(async () => {
                                await command("/finish-invoice-sale", {
                                  acknowledge: true,
                                  acknowledgeOutstanding: outstandingAccepted,
                                });
                                await client.invalidateQueries({
                                  queryKey: getGetStockQueryKey(),
                                });
                                setSoldChoice(true);
                                setMessage(
                                  "Car marked sold and removed from the website.",
                                );
                              })
                            }
                          >
                            Yes, mark sold & remove
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setSoldChoice(true);
                              setMessage(
                                "Invoice saved. The car’s availability has not changed.",
                              );
                            }}
                          >
                            No, keep its current status
                          </Button>
                        </div>
                      </section>
                    )}
                  {issued.invoiceKind === "deposit" && (
                    <p className="invoice-message">
                      The deposit is recorded and the car remains reserved.
                      Reopen this sale when the customer pays again.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setIssued(null);
                      setStep(2);
                      setReviewed(false);
                    }}
                  >
                    Return to this sale
                  </Button>
                </>
              ) : (
                <fieldset disabled={busy}>
                  {step === 0 && (
                    <>
                      <h2>Vehicle & agreed price</h2>
                      <label>
                        Which car is the customer buying?
                        <select
                          aria-label="Vehicle"
                          value={draft.vehicleId}
                          disabled={Boolean(
                            record?.completedAt ||
                            record?.lifecycle?.status === "reserved",
                          )}
                          onChange={(event) => {
                            const car = stock?.cars.find(
                              (c) => c.id === event.target.value,
                            );
                            if (car)
                              setDraft({
                                ...draft,
                                sourceEnquiryId: "",
                                sourceReservationId: "",
                                customerSource: "",
                                vehicleId: car.id,
                                vehicle: vehicleDisplayTitle(car),
                                registration: vehicleRegistration(car),
                                price:
                                  car.price != null ? String(car.price) : "",
                              });
                          }}
                        >
                          <option value="">Choose a stock vehicle</option>
                          {draft.vehicleId && !vehicle && (
                            <option value={draft.vehicleId}>
                              {draft.vehicle} · saved vehicle
                            </option>
                          )}
                          {(stock?.cars ?? [])
                            .filter(
                              (car) =>
                                car.id === draft.vehicleId ||
                                !["sold", "archived"].includes(
                                  String(car.inventoryStatus),
                                ),
                            )
                            .map((car) => (
                              <option key={car.id} value={car.id}>
                                {saleVehicleChoiceLabel(car)}
                              </option>
                            ))}
                        </select>
                      </label>
                      {vehicle && (
                        <div className="invoice-selected-car">
                          <SaleVehiclePhoto key={vehicle.id} car={vehicle} />
                          <div>
                            <strong>{vehicleDisplayTitle(vehicle)}</strong>
                            <p>
                              {[
                                vehicle.year,
                                vehicle.colour,
                                vehicle.fuel,
                                vehicle.transmission,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            <small>
                              {typeof vehicle.mileage === "number"
                                ? `${vehicle.mileage.toLocaleString("en-GB")} miles`
                                : ""}
                            </small>
                          </div>
                        </div>
                      )}
                      <div className="invoice-field-grid">
                        {field("registration", "Registration / number plate")}
                        {field("price", "Agreed vehicle price (£)")}
                      </div>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <details className="invoice-import">
                        <summary>Use a recent enquiry or reservation</summary>
                        <select
                          aria-label="Use recent customer"
                          defaultValue=""
                          disabled={Boolean(record?.completedAt || rows.length)}
                          onChange={(event) => {
                            const source = customerOptions.find(
                              (item) =>
                                item.key === event.target.value &&
                                (!item.vehicleId ||
                                  item.vehicleId === draft.vehicleId),
                            );
                            if (!source) return;
                            setDraft({
                              ...draft,
                              customer: source.name,
                              email: source.email,
                              phone: source.phone,
                              customerSource: source.key,
                              sourceEnquiryId: source.sourceEnquiryId,
                              sourceReservationId: source.sourceReservationId,
                            });
                          }}
                        >
                          <option value="">Choose a recent customer</option>
                          {customerOptions
                            .filter(
                              (source) =>
                                !source.vehicleId ||
                                source.vehicleId === draft.vehicleId,
                            )
                            .map((source) => (
                              <option key={source.key} value={source.key}>
                                {source.name} · {source.key}
                              </option>
                            ))}
                        </select>
                      </details>
                      <h2>Customer details</h2>
                      <div className="invoice-field-grid">
                        {field("customer", "Customer’s full name")}
                        {field("phone", "Telephone", "tel")}
                        {field("email", "Email for the invoice", "email")}
                        <label className="invoice-field-wide">
                          Customer address
                          <Textarea
                            rows={3}
                            value={draft.address}
                            disabled={Boolean(record?.completedAt)}
                            onChange={(event) =>
                              update("address", event.target.value)
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <details className="invoice-optional">
                        <summary>Fees, discounts or part exchange</summary>
                        <p>
                          Only add items agreed with the customer. They appear
                          separately on the invoice.
                        </p>
                        {(draft.adjustments ?? []).map((row, index) => (
                          <div className="invoice-adjustment-row" key={index}>
                            <label>
                              Type
                              <select
                                value={row.kind}
                                disabled={Boolean(record?.completedAt)}
                                onChange={(event) =>
                                  update(
                                    "adjustments",
                                    draft.adjustments!.map((r, i) =>
                                      i === index
                                        ? {
                                            ...r,
                                            kind: event.target.value as
                                              "fee" | "discount",
                                          }
                                        : r,
                                    ),
                                  )
                                }
                              >
                                <option value="fee">Fee</option>
                                <option value="discount">Discount</option>
                              </select>
                            </label>
                            <label>
                              Description
                              <Input
                                value={row.description}
                                disabled={Boolean(record?.completedAt)}
                                onChange={(event) =>
                                  update(
                                    "adjustments",
                                    draft.adjustments!.map((r, i) =>
                                      i === index
                                        ? {
                                            ...r,
                                            description: event.target.value,
                                          }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Amount (£)
                              <Input
                                inputMode="decimal"
                                value={row.amount}
                                disabled={Boolean(record?.completedAt)}
                                onChange={(event) =>
                                  update(
                                    "adjustments",
                                    draft.adjustments!.map((r, i) =>
                                      i === index
                                        ? { ...r, amount: event.target.value }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <Button
                              variant="ghost"
                              disabled={Boolean(record?.completedAt)}
                              onClick={() =>
                                update(
                                  "adjustments",
                                  draft.adjustments!.filter(
                                    (_, i) => i !== index,
                                  ),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          disabled={Boolean(record?.completedAt)}
                          onClick={() =>
                            update("adjustments", [
                              ...(draft.adjustments ?? []),
                              { kind: "fee", description: "", amount: "" },
                            ])
                          }
                        >
                          <Plus size={15} /> Add fee or discount
                        </Button>
                        {(
                          draft.exchanges ??
                          (draft.partExchange
                            ? [
                                {
                                  registration: draft.pxRegistration,
                                  description: draft.pxDescription,
                                  value: draft.pxValue,
                                },
                              ]
                            : [])
                        ).map((row, index, all) => (
                          <div
                            className="invoice-adjustment-row"
                            key={`px-${index}`}
                          >
                            <label>
                              Part-exchange registration
                              <Input
                                value={row.registration}
                                disabled={Boolean(record?.completedAt)}
                                onChange={(event) =>
                                  update(
                                    "exchanges",
                                    all.map((r, i) =>
                                      i === index
                                        ? {
                                            ...r,
                                            registration: event.target.value,
                                          }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Vehicle description
                              <Input
                                value={row.description}
                                disabled={Boolean(record?.completedAt)}
                                onChange={(event) =>
                                  update(
                                    "exchanges",
                                    all.map((r, i) =>
                                      i === index
                                        ? {
                                            ...r,
                                            description: event.target.value,
                                          }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Allowance (£)
                              <Input
                                inputMode="decimal"
                                value={row.value}
                                disabled={Boolean(record?.completedAt)}
                                onChange={(event) =>
                                  update(
                                    "exchanges",
                                    all.map((r, i) =>
                                      i === index
                                        ? { ...r, value: event.target.value }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <Button
                              variant="ghost"
                              disabled={Boolean(record?.completedAt)}
                              onClick={() =>
                                update(
                                  "exchanges",
                                  all.filter((_, i) => i !== index),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          disabled={
                            Boolean(record?.completedAt) ||
                            (draft.exchanges?.length ?? 0) >= 3
                          }
                          onClick={() =>
                            update("exchanges", [
                              ...(draft.exchanges ??
                                (draft.partExchange
                                  ? [
                                      {
                                        registration: draft.pxRegistration,
                                        description: draft.pxDescription,
                                        value: draft.pxValue,
                                      },
                                    ]
                                  : [])),
                              { registration: "", description: "", value: "" },
                            ])
                          }
                        >
                          Add part exchange
                        </Button>
                      </details>
                      <p>
                        Record money actually received, one payment at a time.
                        This does not charge the customer.
                      </p>
                      <div className="invoice-money-summary">
                        <div>
                          <span>Agreed total</span>
                          <strong>{saleMoney(total!.totalDue)}</strong>
                        </div>
                        <div>
                          <span>Received</span>
                          <strong>{saleMoney(total!.confirmedPaid)}</strong>
                        </div>
                        <div>
                          <span>Balance due</span>
                          <strong>{saleMoney(total!.balance)}</strong>
                        </div>
                      </div>
                      {rows.length > 0 && (
                        <div className="invoice-payment-list">
                          {rows.map((row) => (
                            <div key={row.id}>
                              <span>
                                <strong>
                                  {saleMoney(row.signedAmountPence)}
                                </strong>
                                <small>
                                  {paymentDate(row.date)} · {row.method} ·{" "}
                                  {row.status}
                                  {row.reference && ` · ${row.reference}`}
                                </small>
                              </span>
                              {row.status !== "cancelled" &&
                                row.signedAmountPence > 0 && (
                                  <Button
                                    variant="ghost"
                                    onClick={() => setReverse(row)}
                                  >
                                    Correct / refund
                                  </Button>
                                )}
                            </div>
                          ))}
                        </div>
                      )}
                      {total!.balance > 0 && (
                        <form
                          className="invoice-payment-form"
                          onSubmit={addPayment}
                        >
                          <h2>Add a received payment</h2>
                          <div className="invoice-field-grid">
                            <label>
                              Payment amount (£)
                              <Input
                                inputMode="decimal"
                                value={payment.amount}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    amount: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Payment method
                              <select
                                value={payment.method}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    method: event.target.value,
                                  })
                                }
                              >
                                {[
                                  "Bank transfer",
                                  "Cash",
                                  "Debit card",
                                  "Credit card",
                                  "Finance",
                                  "Other",
                                ].map((method) => (
                                  <option key={method}>{method}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Date received
                              <Input
                                type="date"
                                max={todayLondon()}
                                value={payment.date}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    date: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Payment type
                              <select
                                value={payment.kind}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    kind: event.target
                                      .value as typeof payment.kind,
                                    amount:
                                      event.target.value === "final-payment"
                                        ? (total!.balance / 100).toFixed(2)
                                        : payment.amount,
                                  })
                                }
                              >
                                <option value="deposit">
                                  Deposit (reserves the car)
                                </option>
                                <option value="part-payment">
                                  Interim payment
                                </option>
                                <option value="final-payment">
                                  Final payment
                                </option>
                              </select>
                            </label>
                            <label className="invoice-field-wide">
                              Payment reference (optional)
                              <Input
                                value={payment.reference}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    reference: event.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label className="invoice-check">
                            <input
                              type="checkbox"
                              checked={payment.received}
                              onChange={(event) =>
                                setPayment({
                                  ...payment,
                                  received: event.target.checked,
                                })
                              }
                            />
                            I have checked that this money has been received.
                          </label>
                          {pence(payment.amount) > total!.balance && (
                            <p role="alert" className="invoice-error">
                              This payment exceeds the remaining balance.
                            </p>
                          )}
                          <Button
                            type="submit"
                            disabled={
                              busy ||
                              !payment.received ||
                              !(pence(payment.amount) > 0) ||
                              pence(payment.amount) > total!.balance ||
                              !payment.date
                            }
                          >
                            Save payment
                          </Button>
                        </form>
                      )}
                      {total!.balance === 0 && (
                        <p className="invoice-message">
                          The agreed balance is settled.
                        </p>
                      )}
                    </>
                  )}
                  {step === 3 && (
                    <div className="invoice-type-choices">
                      {(["deposit", "full"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          disabled={
                            type === "deposit" && Boolean(record?.completedAt)
                          }
                          aria-pressed={kind === type}
                          onClick={() => {
                            setKind(type);
                            setReviewed(false);
                          }}
                        >
                          <FileText size={24} />
                          <strong>
                            {type === "deposit"
                              ? "Deposit invoice"
                              : "Full invoice"}
                          </strong>
                          <span>
                            {type === "deposit"
                              ? "Record the deposit, reserve the car and show the remaining balance."
                              : "Show the agreed price and every payment received, with dates and methods."}
                          </span>
                          <small>
                            {kind === type ? "Selected" : "Choose this invoice"}
                          </small>
                        </button>
                      ))}
                    </div>
                  )}
                  {step === 4 && (
                    <>
                      <p>
                        The PDF will be generated once you confirm these
                        details.
                      </p>
                      <dl className="invoice-review">
                        <div>
                          <dt>Invoice</dt>
                          <dd>
                            {kind === "deposit"
                              ? "Deposit invoice"
                              : "Full sales invoice"}
                          </dd>
                        </div>
                        <div>
                          <dt>Customer</dt>
                          <dd>
                            {draft.customer}
                            <small>{draft.address}</small>
                          </dd>
                        </div>
                        <div>
                          <dt>Vehicle</dt>
                          <dd>
                            {draft.vehicle}
                            <small>{draft.registration}</small>
                          </dd>
                        </div>
                        <div>
                          <dt>Agreed total</dt>
                          <dd>{saleMoney(total!.totalDue)}</dd>
                        </div>
                        <div>
                          <dt>Payments received</dt>
                          <dd>
                            {saleMoney(total!.confirmedPaid)}
                            <small>
                              {
                                rows.filter((row) => row.status === "confirmed")
                                  .length
                              }{" "}
                              dated payment entries included
                            </small>
                          </dd>
                        </div>
                        <div>
                          <dt>Balance remaining</dt>
                          <dd>{saleMoney(total!.balance)}</dd>
                        </div>
                      </dl>
                      <label className="invoice-check">
                        <input
                          type="checkbox"
                          checked={reviewed}
                          onChange={(event) =>
                            setReviewed(event.target.checked)
                          }
                        />
                        I have checked the customer, car, agreed price and
                        received payments.
                      </label>
                      <p className="invoice-note">
                        Creating the full invoice does not mark the car sold.
                        You’ll be asked afterwards. The PDF uses your
                        dealership’s invoice branding and any approved terms
                        supplied in settings.
                      </p>
                    </>
                  )}
                </fieldset>
              )}
              {record?.documents.length ? (
                <details className="invoice-saved-documents">
                  <summary>Saved paperwork ({record.documents.length})</summary>
                  {[...record.documents].reverse().map((doc) => (
                    <div key={doc.id}>
                      <span>
                        <strong>{doc.title}</strong>
                        <small>{doc.number}</small>
                      </span>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => documentAction(doc, "print")}
                      >
                        Open PDF
                      </Button>
                    </div>
                  ))}
                </details>
              ) : null}
            </div>
          </main>
          {!issued && (
            <footer className="invoice-builder-footer">
              <span>
                {total && Number.isSafeInteger(total.totalDue)
                  ? `Agreed total ${saleMoney(total.totalDue)}`
                  : "Invoice details"}
                {record?.completedAt && " · Sold"}
              </span>
              <div>
                <Button
                  variant="outline"
                  disabled={busy || step === 0}
                  onClick={() => {
                    setStep(step - 1);
                    setProblem("");
                  }}
                >
                  Previous
                </Button>
                {step < 4 ? (
                  <Button disabled={busy} onClick={next}>
                    Continue <ArrowRight size={16} />
                  </Button>
                ) : (
                  <Button disabled={busy || !reviewed} onClick={generate}>
                    <FileText size={16} />
                    {busy
                      ? "Creating…"
                      : kind === "deposit"
                        ? "Create deposit invoice"
                        : "Create full invoice"}
                  </Button>
                )}
              </div>
            </footer>
          )}
        </>
      )}
      {reverse && record && (
        <ReversePaymentDialog
          invoiceOnly
          payment={reverse}
          availablePence={
            reverse.amountPence +
            record.payments
              .filter(
                (row) =>
                  row.reversesPaymentId === reverse.id &&
                  row.status === "confirmed",
              )
              .reduce((sum, row) => sum + row.signedAmountPence, 0)
          }
          busy={busy}
          problem={problem}
          onClose={() => setReverse(null)}
          onSave={(input) =>
            run(async () => {
              await command(`/payments/${reverse.id}/reverse`, {
                ...input,
                invoiceOnly: true,
              });
              setReverse(null);
              setReviewed(false);
              setMessage(
                "Payment corrected. Original invoices remain unchanged; generate an updated invoice with the new balance.",
              );
            })
          }
        />
      )}
    </div>
  );
}
export default function SalesDemo() {
  return <SalesWorkspace />;
}
