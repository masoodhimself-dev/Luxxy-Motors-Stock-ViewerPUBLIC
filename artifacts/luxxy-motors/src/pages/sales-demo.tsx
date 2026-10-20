import { RoadTaxGuide } from "@/components/sales-demo/road-tax-guide";
import { SaleChecklists } from '@/components/sales-demo/sale-checklists';
import { SoldVehicleCustomerReview } from '@/components/portal/sold-vehicle-customer-review';
import { soldVehicleFollowUpsQueryKey } from '@/lib/sold-vehicle-follow-ups';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { useEnquirySummaries as useGetEnquiries } from "@/lib/enquiry-summary-query";
import { SaleVehiclePhoto,saleVehicleChoiceLabel } from '@/components/sales-demo/vehicle-choice';
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import {
  getGetStockQueryKey,
  useListReservations,
} from "@workspace/api-client-react";
import {
  saleWorkspaceTotals,
  saleWorkspaceFingerprint,
  saleWorkspaceChecklistProgress,
  type SaleWorkspaceChecklistInput,
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
import { RecentCustomerFields, type RecentCustomer } from "@/components/portal/recent-customer-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Invoice,
  Plus,
  Printer,
  Download,
  Mail,
  Car,
} from "@/components/icons";
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
  const [taxReference, setTaxReference] = useState("");
  const [kind, setKind] = useState<"deposit" | "full">("full");
  const [step, setStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [contactAutofillNotice, setContactAutofillNotice] = useState("");
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
  const checklistReady = Boolean(record && !detailsDirty && saleWorkspaceChecklistProgress(record).ready);
  const dirty = detailsDirty || Boolean(payment.amount.trim());
  const rows = record?.payments ?? [];
  const total = draft
    ? saleWorkspaceTotals(draft as SaleWorkspaceDraft, rows)
    : null;
  const vehicle = stock?.cars.find((car) => car.id === draft?.vehicleId);
  const showVehicleContext = Boolean(draft && step === 1 && !showSummary && !issued);
  const vehicleChangeLocked = Boolean(record?.completedAt || record?.lifecycle?.status === "reserved");
  const customerOptions = [
    ...(enquiries.data ?? []).map((item) => ({
      id: `enquiry-${item.id}`,
      key: 'Enquiry',
      customerName: item.customerName,
      email: item.email ?? "",
      phone: item.phone ?? "",
      lastUsedAt: item.updatedAt || item.createdAt,
      detail: `Enquiry${item.vehicleTitle ? ` · ${item.vehicleTitle}` : ""}`,
      vehicleId: item.vehicleId ?? "",
      sourceEnquiryId: item.id,
      sourceReservationId: "",
    })),
    ...(reservations.data?.reservations ?? []).map((item) => ({
      id: `reservation-${item.id}`,
      key: 'Reservation',
      customerName: item.customerName,
      email: item.email,
      phone: item.phone,
      lastUsedAt: item.createdAt,
      detail: `Reservation · ${item.vehicleTitle}`,
      vehicleId: item.vehicleId,
      sourceEnquiryId: "",
      sourceReservationId: item.id,
    })),
    ...(sales.data?.sales ?? [])
      .filter((sale) => sale.id !== record?.id)
      .map((sale) => ({
        id: `sale-${sale.id}`,
        key: 'Sale',
        customerName: sale.draft.customer,
        email: sale.draft.email,
        phone: sale.draft.phone,
        lastUsedAt: sale.updatedAt || sale.createdAt,
        detail: `Sale${sale.draft.vehicle ? ` · ${sale.draft.vehicle}` : ""}`,
        vehicleId: sale.draft.vehicleId,
        sourceEnquiryId: "",
        sourceReservationId: "",
      })),
  ];
  function autofillCustomer(customer: RecentCustomer) {
    if (record?.completedAt || rows.length) return;
    const source = customerOptions.find((item) => item.id === customer.id);
    const sameVehicle = source && (!source.vehicleId || source.vehicleId === draft?.vehicleId);
    const hasSavedSource = Boolean(record?.draft.sourceEnquiryId || record?.draft.sourceReservationId);
    setDraft((current) => current ? {
      ...current,
      address: "",
      // Saved sale links are immutable audit evidence. A returning customer's
      // unrelated enquiry must never be attached to this vehicle's new sale.
      sourceEnquiryId: hasSavedSource ? record!.draft.sourceEnquiryId : sameVehicle ? source.sourceEnquiryId : "",
      sourceReservationId: hasSavedSource ? record!.draft.sourceReservationId : sameVehicle ? source.sourceReservationId : "",
      customerSource: hasSavedSource
        ? record!.draft.customerSource
        : sameVehicle ? source.key : "Recent customer autofill",
    } : current);
    setContactAutofillNotice("Contact details filled. Confirm and enter the customer’s current address for this sale.");
    setReviewed(false);
    setProblem("");
  }
  function open(saved?: SaleWorkspaceRecord, initial?: SaleDraft) {
    if (lock.current) return;
    if (dirty && !window.confirm("Leave your unsaved invoice details?")) return;
    setTaxReference("");
    setRecord(saved ?? null);
    setDraft(initial ?? (saved ? structuredClone(saved.draft) : emptyDraft()));
    setStep(0);
    setShowSummary(Boolean(saved));
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
    setContactAutofillNotice("");
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
        customer: source.customerName,
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
  }, [step, Boolean(draft), Boolean(issued), showSummary]);
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
  const saveChecks = (input: SaleWorkspaceChecklistInput) => run(async () => {
    await command('/checklists', input);
    setMessage('Checks saved.');
  });
  const checklistPanel = (intakeOnly = false) => draft ? <SaleChecklists
    draft={draft as SaleWorkspaceDraft}
    checklists={detailsDirty ? undefined : record?.checklists}
    busy={busy} readOnly={Boolean(record?.completedAt || record?.lifecycle?.status === 'sold')}
    intakeOnly={intakeOnly} onChange={saveChecks} /> : null;
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
      const withTaxGuide = doc.type === 'invoice' && doc.invoiceKind === 'full' && doc.snapshot.draft.roadTaxGuide === true;
      const result = await command(`/documents/${doc.id}/email`, withTaxGuide ? { taxGuide: { reference: taxReference } } : {});
      const delivery = result.sale.emailDeliveries
        ?.filter((d) => d.documentId === doc.id)
        .at(-1);
      if (delivery?.status === 'sent') setTaxReference('');
      setMessage(
        delivery?.status === "sent"
          ? withTaxGuide ? "Invoice and Road Tax guide accepted for delivery to the customer." : "Invoice emailed to the customer."
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
    setShowSummary(false);
    setIssued(null);
    setProblem("");
    if (!embedded) navigate("/portal?section=sales");
  }
  const latestInvoice = record?.documents.filter(document => document.type === "invoice").at(-1) ?? null;
  const invoiceIsCurrent = Boolean(latestInvoice && draft &&
    saleWorkspaceFingerprint({ draft: latestInvoice.snapshot.draft, payments: latestInvoice.snapshot.payments }) ===
      saleWorkspaceFingerprint({ draft, payments: rows }));
  const latestPayment = rows.filter(row => row.status === "confirmed").at(-1);
  const saleStatus = record?.completedAt ? "Sold" : record?.lifecycle?.status === "reserved" ? "Reserved" : record?.lifecycle?.status === "released" ? "Released" : "In progress";
  function resumeAt(nextStep: number) {
    if (busy || !draft) return;
    if (nextStep >= 3 && payment.amount.trim()) {
      setShowSummary(false);
      setIssued(null);
      setStep(2);
      setReviewed(false);
      setProblem("Save this payment first, or clear its amount to continue without recording it.");
      return;
    }
    const issues = nextStep >= 2 ? errors({ ...draft, payments: rows }, record?.draft) : [];
    setShowSummary(false);
    setIssued(null);
    setReviewed(false);
    setProblem(issues.join(" "));
    setMessage("");
    setStep(issues.length ? !draft.vehicleId || !(pence(draft.price) > 0) ? 0 : !draft.customer.trim() ? 1 : 2 : nextStep);
    if (nextStep === 3) setKind("full");
  }
  function reviewSavedInvoice() {
    if (payment.amount.trim() || !latestInvoice || !invoiceIsCurrent || latestInvoice.invoiceKind !== "full") {
      resumeAt(3);
      return;
    }
    setShowSummary(false);
    setIssued(latestInvoice);
    setStep(4);
    setReviewed(false);
    setSoldChoice(false);
    setOutstandingAccepted(false);
    setProblem("");
    setMessage("");
  }
  const resumeAction = !draft || !total ? null
    : !draft.vehicleId || !(pence(draft.price) > 0)
      ? { label: "Add vehicle details", note: "Choose the car and confirm the agreed price.", run: () => resumeAt(0) }
    : !draft.customer.trim()
      ? { label: "Add customer details", note: "Add the buyer’s details before payments or paperwork.", run: () => resumeAt(1) }
    : total.balance < 0 || total.pending > 0
      ? { label: "Review payments", note: total.balance < 0 ? "Review the customer’s credit before continuing." : "Pending payments are not included in the amount received.", run: () => resumeAt(2) }
    : record?.completedAt && total.balance === 0 && latestInvoice && invoiceIsCurrent
      ? { label: "Open latest invoice", note: "The sale is complete and the balance is settled.", run: () => documentAction(latestInvoice, "print") }
    : latestInvoice?.invoiceKind === "full" && invoiceIsCurrent && !record?.completedAt
      ? { label: "Review sale completion", note: "The full invoice is saved. Review it and choose whether to mark the car sold.", run: reviewSavedInvoice }
    : total.balance > 0
      ? { label: "Record a payment", note: "Continue with the next payment, or prepare the invoice when you need it.", run: () => resumeAt(2) }
    : { label: latestInvoice ? "Create updated invoice" : "Create invoice", note: latestInvoice ? "The details or payments have changed since the saved invoice." : "The balance is settled. Prepare the customer’s invoice.", run: () => resumeAt(3) };
  const matchingSales = (sales.data?.sales ?? []).filter((sale) =>
    `${sale.reference} ${sale.draft.customer} ${sale.draft.vehicle} ${sale.draft.registration}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  function field(
    key: "customer" | "phone" | "email" | "registration" | "price",
    label: string,
    type = "text",
  ) {
    return (
      <label>
        {label}
        {key === "registration" ? <UKNumberPlate editable required={false} variant="front" value={draft?.registration ?? ""}
          inputLabel={label} onChange={value => update("registration",value)} disabled={Boolean(record?.completedAt)} /> : <Input
          type={type}
          value={draft?.[key] ?? ""}
          onChange={(event) => update(key, event.target.value)}
          disabled={Boolean(record?.completedAt)}
          inputMode={key === "price" ? "decimal" : undefined}
        />}
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
          {record && !showSummary && !issued && <Button variant="ghost" disabled={busy} onClick={() => { setShowSummary(true); setProblem(""); }}>Sale summary</Button>}
          {draft && (!showSummary || detailsDirty) && (
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
            placeholder="Search customer, car or registration"
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
            {matchingSales.map((sale) => (
                <button key={sale.id} data-sale-status={sale.completedAt ? 'sold' : sale.lifecycle?.status === 'reserved' ? 'reserved' : 'in-progress'} onClick={() => open(sale)}>
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
                          : "In progress"}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
          </div>
          {!sales.isLoading && !sales.isError && Boolean(sales.data?.sales.length) && !matchingSales.length && (
            <div className="invoice-empty" role="status">
              <h2>No matching sales</h2>
              <p>Try another customer, car or registration.</p>
            </div>
          )}
          {!sales.isLoading && !sales.isError && !sales.data?.sales.length && (
            <div className="invoice-empty">
              <Invoice size={32} />
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
          {!issued && !showSummary && (
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
                  data-complete={index < step}
                >
                  <b>{index < step ? <Check size={14} /> : index + 1}</b>
                  <span className="invoice-step-label">{label}</span>
                </span>
              ))}
            </nav>
          )}
          <main ref={scrollPane} className="invoice-builder-scroll">
            <div className={`invoice-step-layout${showVehicleContext ? " has-vehicle-context" : ""}`}>
              {showVehicleContext && draft && (
                <aside className="invoice-car-context" aria-label="Selected car">
                  <div className="invoice-car-context-photo">
                    <Car size={36} aria-hidden="true" />
                    {vehicle && <SaleVehiclePhoto key={vehicle.id} car={vehicle} />}
                  </div>
                  <div className="invoice-car-context-details">
                    <p className="invoice-builder-kicker">Selected car</p>
                    <h2>{draft.vehicle || "Selected vehicle"}</h2>
                    {vehicle?.variant && <p className="invoice-car-context-variant">{vehicle.variant}</p>}
                    <UKNumberPlate value={draft.registration} size="sm" variant="front" />
                  </div>
                  {vehicle && (
                    <div className="invoice-car-context-specs">
                      <p>{[vehicle.year, vehicle.colour].filter(Boolean).join(" · ")}</p>
                      <p>{[vehicle.fuel, vehicle.transmission].filter(Boolean).join(" · ")}</p>
                      {typeof vehicle.mileage === "number" && <p>{vehicle.mileage.toLocaleString("en-GB")} miles</p>}
                    </div>
                  )}
                  <div className="invoice-car-context-footer">
                    <dl><dt>Agreed price</dt><dd>{saleMoney(pence(draft.price))}</dd></dl>
                    <Button type="button" variant="outline" disabled={busy || vehicleChangeLocked} onClick={() => {
                      setStep(0);
                      setProblem("");
                      setReviewed(false);
                    }}>Change car</Button>
                  </div>
                  {vehicleChangeLocked && <p className="invoice-car-context-lock">{record?.completedAt ? "The car is fixed for this completed sale." : "The car is fixed while this sale is reserved."}</p>}
                </aside>
              )}
            <div className={`invoice-question-sheet${showSummary ? " invoice-resume-sheet" : ""}`} data-view={showSummary ? "summary" : issued ? "issued" : `step-${step + 1}`}>
              <div className="invoice-question-heading">
              <p className="invoice-builder-kicker">
                {showSummary && record ? "Saved sale" : issued ? "Invoice saved" : `Step ${step + 1} of 5`}
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {showSummary ? "Sale summary" : issued ? "Your invoice is ready." : questions[step]}
              </h1>
              </div>
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
              {showSummary && record && total ? (
                <section className="invoice-resume" aria-label="Saved sale summary">
                  <div className="invoice-resume-identity">
                    <div className="invoice-resume-car">{vehicle && <SaleVehiclePhoto car={vehicle} />}<div><strong>{draft.vehicle || "Vehicle to add"}</strong><p>{[draft.registration, draft.customer || "Customer to add"].filter(Boolean).join(" · ")}</p>{(draft.phone || draft.email) && <small>{[draft.phone, draft.email].filter(Boolean).join(" · ")}</small>}</div></div>
                    <span className="invoice-resume-status" data-status={saleStatus.toLowerCase().replaceAll(" ", "-")}>{saleStatus}</span>
                  </div>
                  {dirty && <p className="invoice-resume-unsaved" role="status">Your unsaved entries are still here. Save details or return to the payment form to record them.</p>}
                  <dl className="invoice-resume-totals" aria-label="Sale amounts"><div><dt>Agreed total</dt><dd>{saleMoney(total.totalDue)}</dd></div><div><dt>Paid</dt><dd>{saleMoney(total.confirmedPaid)}</dd></div><div data-balance={total.balance === 0 ? "settled" : "due"}><dt>{total.balance < 0 ? "Customer credit" : "Balance due"}</dt><dd>{saleMoney(Math.abs(total.balance))}</dd></div></dl>
                  {resumeAction && <div className="invoice-resume-next"><div><strong>Pick up where you left off</strong><p>{resumeAction.note}</p></div><Button disabled={busy} onClick={resumeAction.run}>{resumeAction.label}<ArrowRight size={16} aria-hidden="true" /></Button></div>}
                  <div className="invoice-resume-records">
                    <section aria-labelledby="resume-payments-heading"><h2 id="resume-payments-heading">Payment history</h2><p>{rows.length ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"} recorded` : "No payments recorded yet."}</p>{latestPayment && <small>Latest: {saleMoney(latestPayment.signedAmountPence)} · {paymentDate(latestPayment.date)} · {latestPayment.method}</small>}{total.pending > 0 && <small>{saleMoney(total.pending)} pending — not yet received.</small>}<Button variant="outline" disabled={busy} onClick={() => resumeAt(2)}>Record payment</Button></section>
                    <section aria-labelledby="resume-invoice-heading"><h2 id="resume-invoice-heading">Invoice</h2>{latestInvoice ? <><p>{latestInvoice.title} · {latestInvoice.number}</p><small>Issued {new Date(latestInvoice.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{!invoiceIsCurrent ? " · Changes since issue" : ""}</small><Button variant="outline" disabled={busy} onClick={() => documentAction(latestInvoice, "print")}>Open invoice</Button></> : <p>No invoice created yet.</p>}<Button variant="ghost" disabled={busy} onClick={() => resumeAt(3)}>{latestInvoice ? "Create another invoice" : "Prepare invoice"}</Button></section>
                  </div>
                  {rows.length > 0 && <section className="invoice-summary-payments" aria-label="Recorded payments"><ul>{rows.map(row => <li key={row.id} data-status={row.status}><div><strong>{saleMoney(row.signedAmountPence)}</strong><span>{paymentDate(row.date)} · {row.method}</span></div><small>{row.status === "confirmed" ? row.signedAmountPence < 0 ? "Returned / reversed" : "Received" : row.status}{row.reference && ` · ${row.reference}`}</small></li>)}</ul></section>}
                  <div className="invoice-resume-edit"><span>{record.completedAt ? "Completed details are locked. Issued invoices remain unchanged." : "Need to correct something?"}</span><Button variant="ghost" disabled={busy} onClick={() => resumeAt(0)}>{record.completedAt ? "View vehicle details" : "Edit vehicle & price"}</Button><Button variant="ghost" disabled={busy} onClick={() => resumeAt(1)}>{record.completedAt ? "View customer details" : "Edit customer details"}</Button></div>
                  {(record.completedAt || record.lifecycle?.status === 'sold') && <SoldVehicleCustomerReview saleId={record.id} />}
                  {record.documents.length > 1 && <details className="invoice-resume-paperwork"><summary>All saved paperwork ({record.documents.length})</summary>{[...record.documents].reverse().map(document => <div key={document.id}><span>{document.title}<small>{document.number}</small></span><Button variant="outline" size="sm" disabled={busy} onClick={() => documentAction(document, "print")}>Open {document.number}</Button></div>)}</details>}
                </section>
              ) : issued ? (
                <>
                  <div className="invoice-ready-card">
                    <Invoice size={32} />
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
                  {issued.type === 'invoice' && issued.invoiceKind === 'full' && issued.snapshot.draft.roadTaxGuide && <RoadTaxGuide
                    enabled reference={taxReference} onReferenceChange={setTaxReference} disabled={busy}
                    invoiceReady customerEmail={issued.snapshot.draft.email} />}
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
                      disabled={busy || !issued.snapshot.draft.email || (issued.invoiceKind === 'full' && issued.snapshot.draft.roadTaxGuide === true && !/^\d{12}$/.test(taxReference))}
                      onClick={() => email(issued)}
                    >
                      <Mail size={17} /> {issued.invoiceKind === 'full' && issued.snapshot.draft.roadTaxGuide ? 'Email invoice & tax guide' : 'Email customer'}
                    </Button>
                  </div>
                  {issued.invoiceKind === 'full' && record && <SoldVehicleCustomerReview key={`${record.id}:${record.lifecycle?.status ?? 'draft'}`} saleId={record.id} />}
                  {issued.invoiceKind === "full" &&
                    !record?.completedAt &&
                    !soldChoice && (
                      <section className="invoice-sold-question">
                        <h2>Should this car be marked sold?</h2>
                        <p>
                          Marking it sold removes it from the customer website.
                          Your invoice and payments stay saved.
                        </p>
                        {checklistPanel()}
                        {total!.balance > 0 && (
                          <>
                            <p className="invoice-message" data-tone="warning">
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
                              !checklistReady ||
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
                                await client.invalidateQueries({ queryKey: soldVehicleFollowUpsQueryKey });
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
                            setTaxReference('');
                            if (car)
                              setDraft({
                                ...draft,
                                sourceEnquiryId: "",
                                sourceReservationId: "",
                                customerSource: "",
                                vin: "",
                                roadTaxGuide: false,
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
                      <h2>Customer details</h2>
                      <RecentCustomerFields
                        value={{ customerName: draft.customer, phone: draft.phone, email: draft.email }}
                        customers={customerOptions}
                        disabled={Boolean(record?.completedAt)}
                        suggestionsDisabled={Boolean(rows.length)}
                        nameLabel="Customer’s full name"
                        phoneLabel="Telephone"
                        emailLabel="Email for the invoice"
                        nameRequired
                        nameMaxLength={200}
                        onChange={(contact) => {
                          setDraft((current) => current ? {
                            ...current,
                            customer: contact.customerName,
                            phone: contact.phone ?? "",
                            email: contact.email ?? "",
                          } : current);
                          setReviewed(false);
                          setProblem("");
                          setContactAutofillNotice("");
                        }}
                        onSelect={autofillCustomer}
                      />
                      {(enquiries.isError || reservations.isError || sales.isError) && (
                        <p className="text-sm text-muted-foreground">Some recent customer details could not be loaded. You can still enter the customer’s details.</p>
                      )}
                      {(enquiries.isLoading || reservations.isLoading || sales.isLoading) && (
                        <p className="text-sm text-muted-foreground" role="status">Loading recent customers…</p>
                      )}
                      {contactAutofillNotice && <p className="text-sm text-muted-foreground" role="status">{contactAutofillNotice}</p>}
                      <div className="invoice-field-grid">
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
                        {!record?.completedAt && !rows.length && <small className="invoice-field-wide">Choosing a recent customer clears this address. Confirm their current address for this sale.</small>}
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
                      {checklistPanel(true)}
                      <p>
                        Record money actually received, one payment at a time.
                        This does not charge the customer.
                      </p>
                      <div className="invoice-money-summary">
                        <div>
                          <span>Agreed total</span>
                          <strong>{saleMoney(total!.totalDue)}</strong>
                        </div>
                        <div data-kind="received">
                          <span>Received</span>
                          <strong>{saleMoney(total!.confirmedPaid)}</strong>
                        </div>
                        <div data-kind="balance" data-balance={total!.balance === 0 ? 'settled' : total!.balance < 0 ? 'credit' : 'outstanding'}>
                          <span>Balance due</span>
                          <strong>{saleMoney(total!.balance)}</strong>
                        </div>
                      </div>
                      {rows.length > 0 && (
                        <div className="invoice-payment-list">
                          {rows.map((row) => (
                            <div key={row.id} data-status={row.status}>
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
                        <p className="invoice-message" data-tone="success">
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
                          <Invoice size={24} />
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
                            {draft.vin && <small>VIN: {draft.vin}</small>}
                          </dd>
                        </div>
                        <div>
                          <dt>Agreed total</dt>
                          <dd>{saleMoney(total!.totalDue)}</dd>
                        </div>
                        <div data-kind="received">
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
                        <div data-kind="balance" data-balance={total!.balance === 0 ? 'settled' : total!.balance < 0 ? 'credit' : 'outstanding'}>
                          <dt>Balance remaining</dt>
                          <dd>{saleMoney(total!.balance)}</dd>
                        </div>
                      </dl>
                      {kind === 'full' && <section className="invoice-final-paperwork" aria-label="Vehicle paperwork">
                        <h2>Vehicle paperwork</h2>
                        <p className="invoice-note">Confirm the VIN and choose whether to include a tax guide when emailing the full invoice.</p>
                        <label>VIN / chassis number
                          <Input value={draft.vin ?? ""} maxLength={17} autoComplete="off" spellCheck={false}
                            disabled={Boolean(record?.completedAt)} placeholder="17-character VIN"
                            onChange={event => update("vin", event.target.value.toUpperCase().replace(/\s/g, ""))} />
                          <small>Copy from the vehicle or log book. Leave blank if not available yet.</small>
                        </label>
                      <RoadTaxGuide enabled={draft.roadTaxGuide === true} disabled={Boolean(record?.completedAt)}
                        reference={taxReference} onReferenceChange={setTaxReference}
                        onChange={enabled => update("roadTaxGuide", enabled)} />
                      </section>}
                      {kind === 'full' && checklistPanel()}
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
              {!showSummary && record?.documents.length ? (
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
            </div>
          </main>
          {!issued && !showSummary && (
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
                    <Invoice size={16} />
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
