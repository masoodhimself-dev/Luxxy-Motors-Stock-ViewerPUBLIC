import {PartExchangeMotCheck} from '@/components/mot-history';
import { AddressPostcodeHelper } from '@/components/postcode-field';
import { SaleHandover, SaleHandoverFields, handoverDefaults } from '@/components/portal/sale-handover';
import { SaleChecklists } from '@/components/sales-demo/sale-checklists';
import { CompletedSaleCorrectionHelp } from '@/components/sales-demo/completed-sale-correction-help';
import { SoldVehicleCustomerReview } from '@/components/portal/sold-vehicle-customer-review';
import { soldVehicleFollowUpsQueryKey } from '@/lib/sold-vehicle-follow-ups';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { useEnquirySummaries as useGetEnquiries } from "@/lib/enquiry-summary-query";
import { SaleVehiclePhoto,saleVehicleChoiceLabel } from '@/components/sales-demo/vehicle-choice';
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import {
  getGetStockQueryKey,
} from "@workspace/api-client-react";
import {
  saleWorkspaceTotals,
  saleWorkspaceChecklistProgress,
  saleWorkspaceRetainedIntakeChecks,
  type SaleWorkspaceChecklistInput,
  type SaleWorkspaceRecord,
  type SaleWorkspaceMutation,
  type SaleWorkspaceDocument,
  type SaleWorkspaceDraft,
  type SaleWorkspacePayment,
} from "@workspace/vehicle-meta";
import { useStock } from "@/lib/stock-context";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useDealerFeatures } from "@/lib/dealer-features";
import { saleInvoiceIsCurrent } from '@/lib/sale-invoice-current';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useStaffAccess } from '@/components/portal/dealer-administration';
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
  Trash2,
} from "@/components/icons";
import "@/sales-workspace.css";
import "./invoice-builder.css";

export interface SalesWorkspaceProps {
  embedded?: boolean;
  newSaleRequest?: number;
  onExit?: () => void;
}
type SaleListRow = SaleWorkspaceRecord & { listSummary?: boolean; listTotalDue?: number; listPaid?: number; listPending?: number; listLedgerKnown?: boolean; listBalance?: number; listHasCorrectionNotes?: boolean; listHasRefunds?: boolean; listHandover?: { method: 'collection' | 'delivery'; status: string } | null };

/** List summaries deliberately contain totals, not customer payment details. */
function saleListProgress(sale: SaleListRow) {
  const handover = sale.listHandover;
  const balance = sale.listBalance;
  const correctionReview = Boolean(sale.listHasCorrectionNotes || sale.corrections?.length || (sale.completedAt && (sale.listHasRefunds || sale.payments?.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0))));
  const done = handover?.status === 'Collected' || handover?.status === 'Delivered';
  const status = done ? handover!.status : sale.completedAt ? 'Sold' : sale.lifecycle?.status === 'reserved' ? 'Reserved' : sale.lifecycle?.status === 'released' ? 'Released' : 'In progress';
  const action = sale.lifecycle?.status === 'released' ? sale.listLedgerKnown === false || (sale.listPending ?? 0) > 0 || (sale.listPaid ?? 0) !== 0 ? 'Review payment history' : correctionReview ? 'Review correction with accountant' : 'Sale not completed'
    : correctionReview ? 'Review correction with accountant' : !sale.draft.vehicleId ? 'Add the vehicle' : !sale.draft.customer?.trim() ? 'Add customer details' : sale.listLedgerKnown === false ? 'Review payment history'
    : typeof balance !== 'number' ? 'Open sale to review the balance'
    : balance < 0 ? 'Review customer credit' : (sale.listPending ?? 0) > 0 ? 'Review pending payments'
    : balance > 0 ? 'Review the balance due'
    : sale.completedAt && !done ? handover?.status === 'To arrange' || !handover ? 'Arrange collection or delivery' : 'Review the handover'
    : sale.completedAt ? 'Sale completed' : 'Review invoice and sale';
  return { status, action, handover, balance, correctionReview };
}
type SaleListPage = { sales: SaleListRow[]; hasMore?: boolean };
const salesListKey = ['sale-workspace', 'list'] as const;
function salesListUrl(q = '', offset = 0) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (offset) params.set('offset', String(offset));
  return `/api/sale-workspace${params.size ? `?${params}` : ''}`;
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
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const { settings } = useDealerSettings();
  const features = useDealerFeatures();
  const canEmailCustomer = features.enabled('customerEmails');
  const emailAvailabilityId = useId();
  const emailUnavailableReason = features.isLoading
    ? 'Checking email availability…'
    : features.isError
      ? 'Email availability could not be checked. Retry the availability check before sending. Your invoice is saved.'
      : 'Customer email sending is switched off by platform administration. You can still print or download the saved invoice.';
  const enquiries = useGetEnquiries();
  const client = useQueryClient();
  const access = useStaffAccess();
  const canManageSales = access.data?.permissions.includes('sales.manage') === true;
  const [filter, setFilter] = useState(''), [listSearch, setListSearch] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openRequest = useRef(0), openController = useRef<AbortController | null>(null);
  useEffect(() => { const timer = setTimeout(() => setListSearch(filter.trim()), 250); return () => clearTimeout(timer); }, [filter]);
  useEffect(() => () => { openRequest.current++; openController.current?.abort(); }, []);
  const sales = useInfiniteQuery({
    queryKey: [...salesListKey, listSearch],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => customFetch<SaleListPage>(salesListUrl(listSearch, pageParam), { signal }),
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? pages.reduce((total, page) => total + page.sales.length, 0) : undefined,
    retry: false,
  });
  const listRows = useMemo(() => {
    const seen = new Set<string>();
    return (sales.data?.pages.flatMap(page => page.sales) ?? []).filter(sale => { if (seen.has(sale.id)) return false; seen.add(sale.id); return true; });
  }, [sales.data]);
  const [record, setRecord] = useState<SaleWorkspaceRecord | null>(null);
  const correctionPaperwork = useQuery({
    queryKey: ['sale-workspace', 'correction-instructions', typeof window === 'undefined' ? '' : window.location.host, record?.id],
    queryFn: ({ signal }) => customFetch<{ correctionSettings?: { handling: 'accountant'; instructions: string } }>('/api/sale-workspace/paperwork', { signal }),
    enabled: Boolean(record?.completedAt || record?.documents.some(document => document.type === 'invoice')),
    retry: false,
    gcTime: 0,
  });
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false);
  const [releaseReservationOpen, setReleaseReservationOpen] = useState(false);
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [kind, setKind] = useState<"deposit" | "full">("full");
  const [step, setStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [contactAutofillNotice, setContactAutofillNotice] = useState("");
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
  const stockDeferredSource = useRef("");
  const consumedNew = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const scrollPane = useRef<HTMLElement>(null);
  const detailsDirty = Boolean(
    draft && JSON.stringify(draft) !== JSON.stringify(record?.draft),
  );
  const checklistReady = Boolean(record && !detailsDirty && saleWorkspaceChecklistProgress(record).ready);
  const dirty = detailsDirty || Boolean(payment.amount.trim());
  const canDeleteDraft = Boolean(record?.emptyDraftDeletable && access.data?.permissions.includes('sales.manage'));
  const rows = record?.payments ?? [];
  const total = draft
    ? saleWorkspaceTotals(draft as SaleWorkspaceDraft, rows)
    : null;
  const vehicle = stock?.cars.find((car) => car.id === draft?.vehicleId);
  const showVehicleContext = Boolean(draft && step === 1 && !showSummary && !issued);
  const vehicleChangeLocked = Boolean(record?.completedAt || record?.lifecycle?.status === "reserved");
  const [customerLookup, setCustomerLookup] = useState('');
  const customerLookupInput = draft && step === 1 && !showSummary && !issued
    ? [draft.customer, draft.phone, draft.email].map(value => value.trim()).find(value => value.length >= 2) ?? '' : '';
  useEffect(() => { const timer = setTimeout(() => setCustomerLookup(customerLookupInput), 250); return () => clearTimeout(timer); }, [customerLookupInput]);
  const customerSales = useQuery({
    queryKey: ['sale-workspace', 'customer-lookup', customerLookup],
    queryFn: ({ signal }) => customFetch<SaleListPage>(salesListUrl(customerLookup), { signal }),
    enabled: Boolean(customerLookup && customerLookup === customerLookupInput),
    retry: false,
    staleTime: 30_000,
  });
  const recentSales = [...new Map([...listRows, ...(customerLookup === customerLookupInput ? customerSales.data?.sales ?? [] : [])].map(sale => [sale.id, sale])).values()];
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
    ...recentSales
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
  function displaySale(saved?: SaleWorkspaceRecord, initial?: SaleDraft) {
    setDeleteDraftOpen(false);
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
  async function open(saved?: Pick<SaleListRow, 'id'>, initial?: SaleDraft) {
    if (lock.current || (!saved && !canManageSales)) return;
    if (dirty && !window.confirm('Leave your unsaved invoice details?')) { openRequest.current++; openController.current?.abort(); setOpeningId(null); return; }
    const request = ++openRequest.current;
    openController.current?.abort();
    const controller = new AbortController(); openController.current = controller;
    setProblem('');
    if (!saved) { setOpeningId(null); displaySale(undefined, initial); return; }
    setOpeningId(saved.id);
    try {
      const result = await customFetch<{ sale: SaleListRow }>(`/api/sale-workspace/${encodeURIComponent(saved.id)}`, { signal: controller.signal });
      if (controller.signal.aborted || request !== openRequest.current) return;
      if (!result.sale || result.sale.id !== saved.id || result.sale.listSummary || !Array.isArray(result.sale.documents) || !Array.isArray(result.sale.payments)) throw new Error('The complete sale could not be loaded. Refresh sales and try again.');
      displaySale(result.sale);
    } catch (error) {
      if (!controller.signal.aborted && request === openRequest.current) setProblem((error as { data?: { error?: string } })?.data?.error || 'This sale could not be loaded. Refresh sales and try again.');
    } finally { if (request === openRequest.current) setOpeningId(null); }
  }
  useEffect(() => {
    if (newSaleRequest > 0 && newSaleRequest !== consumedNew.current) {
      consumedNew.current = newSaleRequest;
      open();
    }
  }, [newSaleRequest]);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (embedded && params.get('section') !== 'sales') return;
    const id = params.get('saleId'), enquiryId = params.get('enquiryId'), reservationId = params.get('reservationId');
    const key = [id, enquiryId, reservationId].join(':');
    if (key === '::' || key === consumed.current || lock.current || (!id && enquiries.isLoading)) return;
    if (!id && stockLoading) {
      stockDeferredSource.current = key;
      setOpeningId(`source:${enquiryId || reservationId}`);
      return;
    }
    // A late stock response must not replace an invoice staff started while waiting.
    if (stockDeferredSource.current === key && dirty) {
      consumed.current = key;
      stockDeferredSource.current = '';
      setOpeningId(null);
      return;
    }
    stockDeferredSource.current = '';
    consumed.current = key;
    if (id) { void open({ id }); return; }
    const request = ++openRequest.current;
    openController.current?.abort(); const controller = new AbortController(); openController.current = controller;
    setOpeningId(`source:${enquiryId || reservationId}`); setProblem('');
    const paramsForSource = new URLSearchParams(enquiryId ? { enquiryId } : { reservationId: reservationId! });
    void customFetch<SaleListPage>(`/api/sale-workspace?${paramsForSource}`, { signal: controller.signal }).then(async result => {
      if (controller.signal.aborted || request !== openRequest.current) return;
      if (!Array.isArray(result.sales)) throw new Error('Invalid sale lookup');
      // A released enquiry may be reused only after checking every matching page.
      // The server checks the same rules again under its transaction lock.
      const results = [...result.sales];
      if (enquiryId) {
        let page = result, offset = result.sales.length;
        while (page.hasMore) {
          if (!page.sales.length || offset > 10000) throw new Error('Incomplete sale lookup');
          const nextParams = new URLSearchParams(paramsForSource); nextParams.set('offset', String(offset));
          page = await customFetch<SaleListPage>(`/api/sale-workspace?${nextParams}`, { signal: controller.signal });
          if (controller.signal.aborted || request !== openRequest.current) return;
          if (!Array.isArray(page.sales)) throw new Error('Invalid sale lookup');
          results.push(...page.sales); offset += page.sales.length;
        }
      }
      const matches = results.filter(sale => enquiryId ? sale.draft.sourceEnquiryId === enquiryId : sale.draft.sourceReservationId === reservationId);
      const safeReleased = (sale: SaleListRow) => sale.lifecycle?.status === 'released' && !sale.completedAt && !sale.draft.sourceReservationId && sale.listLedgerKnown === true && typeof sale.listPaid === 'number' && sale.listPaid === 0 && typeof sale.listPending === 'number' && sale.listPending === 0;
      const existing = enquiryId ? matches.find(sale => sale.lifecycle?.status !== 'released') ?? matches.find(sale => !safeReleased(sale)) : matches[0];
      if (existing) { void open(existing); return; }
      const source = customerOptions.find(item => enquiryId ? item.sourceEnquiryId === enquiryId : reservationId && item.sourceReservationId === reservationId);
      if (!source) { setOpeningId(null); setProblem('This customer record could not be found. Reopen the original enquiry before starting its sale.'); return; }
      const car = stock?.cars.find(item => item.id === source.vehicleId);
      const linkedEnquiry = enquiryId ? enquiries.data?.find(item => item.id === enquiryId) : undefined;
      void open(undefined, { ...emptyDraft(), customer: source.customerName, email: source.email, phone: source.phone,
        vehicleId: source.vehicleId, vehicle: car ? vehicleDisplayTitle(car) : linkedEnquiry?.vehicleTitle || '', registration: car ? vehicleRegistration(car) : linkedEnquiry?.vehicleRegistration || '', price: car?.price != null ? String(car.price) : '',
        sourceEnquiryId: source.sourceEnquiryId, sourceReservationId: source.sourceReservationId, customerSource: source.key });
      if (stockError) setProblem('Current stock could not be loaded. The enquiry details are kept; confirm the car and enter the agreed price before continuing.');
    }).catch(() => { if (!controller.signal.aborted && request === openRequest.current) { setOpeningId(null); setProblem('The linked sale could not be checked. Reopen the enquiry or refresh sales before continuing.'); } });
  }, [search, enquiries.data, enquiries.isLoading, stock, stockLoading, stockError]);
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
    void client.invalidateQueries({ queryKey: ['sale-workspace'] }).catch(() => {});
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
  function deleteSavedDraft() {
    if (!record || !canDeleteDraft || dirty) return;
    const deleting = record;
    run(async () => {
      const result = await customFetch<{ deleted: boolean; id: string }>(`/api/sale-workspace/${deleting.id}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: deleting.revision, confirm: true }) });
      if (result.deleted !== true || result.id !== deleting.id) throw new Error('Could not confirm deletion. Reload the saved sales before trying again.');
      client.setQueriesData<{ pages: SaleListPage[]; pageParams: unknown[] }>({ queryKey: salesListKey }, previous => previous ? { ...previous, pages: previous.pages.map(page => ({ ...page, sales: page.sales.filter(sale => sale.id !== deleting.id) })) } : previous);
      setDeleteDraftOpen(false); setRecord(null); setDraft(null); setIssued(null); setShowSummary(false);
      if (embedded) navigate('/portal?section=sales');
      setMessage('Draft deleted.');
      // A failed background refresh must not make a completed deletion look like a failure.
      void client.invalidateQueries({ queryKey: ['sale-workspace'] }).catch(() => {});
    });
  }
  const saveChecks = (input: SaleWorkspaceChecklistInput) => run(async () => {
    await command('/checklists', input);
    setMessage('Checks saved.');
  });
  const checklistPanel = (intakeOnly = false) => draft ? <SaleChecklists
    draft={draft as SaleWorkspaceDraft}
    checklists={record ? { completion: record.checklists?.completion ?? {}, partExchanges: saleWorkspaceRetainedIntakeChecks(record, draft as SaleWorkspaceDraft) } : undefined}
    busy={busy} readOnly={Boolean(record?.completedAt || record?.lifecycle?.status === 'sold')}
    intakeOnly={intakeOnly} onChange={saveChecks}
    onReviewIntake={() => { setIssued(null); setShowSummary(false); setStep(2); setProblem(''); }} /> : null;
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
    if (canManageSales && step === 3 && draft && !draft.fulfilment?.recipient && !record?.draft.fulfilment?.completedAt) setDraft({...draft,fulfilment:{...handoverDefaults(draft),recipient:draft.customer,phone:draft.fulfilment?.phone||draft.phone,address:draft.fulfilment?.address||draft.address}});
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
    if (!canEmailCustomer) { setProblem(emailUnavailableReason); return; }
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
  function prepareDocumentEmail(doc: SaleWorkspaceDocument) {
    setIssued(doc);
    setShowSummary(false);
    setMessage(canEmailCustomer ? "Review this saved document, then choose Email customer to send it through the dealership email system." : `Review this saved document. ${emailUnavailableReason}`);
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
  const needsCorrectionReview = Boolean(record?.corrections?.length || (record?.completedAt && rows.some(row => row.status === 'confirmed' && row.signedAmountPence < 0)));
  const invoiceIsCurrent = Boolean(latestInvoice && draft && saleInvoiceIsCurrent(latestInvoice, draft, rows));
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
  const resumeAction = !draft || !total || record?.lifecycle?.status === 'released' ? null
    : !draft.vehicleId || !(pence(draft.price) > 0)
      ? { label: "Add vehicle details", note: "Choose the car and confirm the agreed price.", run: () => resumeAt(0) }
    : !draft.customer.trim()
      ? { label: "Add customer details", note: "Add the buyer’s details before payments or paperwork.", run: () => resumeAt(1) }
    : needsCorrectionReview
      ? { label: "Review payment history", note: "External corrections are not included in the calculated balance. Check with your accountant before treating it as money owed.", run: () => resumeAt(2) }
    : total.balance < 0 || total.pending > 0
      ? { label: "Review payments", note: total.balance < 0 ? "Review the customer’s credit before continuing." : "Pending payments are not included in the amount received.", run: () => resumeAt(2) }
    : record?.completedAt && total.balance === 0 && latestInvoice && invoiceIsCurrent
      ? { label: "Open latest invoice", note: !draft.fulfilment?.completedAt ? `The balance is settled. ${draft.fulfilment?.method === "delivery" ? "Delivery" : "Collection or delivery"} is still outstanding; see the arrangements above.` : "The sale and handover are complete, and the balance is settled.", run: () => documentAction(latestInvoice, "print") }
    : latestInvoice?.invoiceKind === "full" && invoiceIsCurrent && !record?.completedAt
      ? { label: "Review sale completion", note: "The full invoice is saved. Review it and choose whether to mark the car sold.", run: reviewSavedInvoice }
    : total.balance > 0
      ? { label: "Record a payment", note: "Continue with the next payment, or prepare the invoice when you need it.", run: () => resumeAt(2) }
    : { label: latestInvoice ? "Create updated invoice" : "Create invoice", note: latestInvoice ? "The details or payments have changed since the saved invoice." : "The balance is settled. Prepare the customer’s invoice.", run: () => resumeAt(3) };
  const matchingSales = listRows;
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
          {canManageSales && draft && (!showSummary || detailsDirty) && (
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
              <h1>Sales & invoices</h1>
              <p>
                {access.data?.permissions.includes('sales.manage') ? 'Create a deposit invoice or a full sales invoice in five short steps.' : 'View existing sales, invoices and payments.'}
              </p>
            </div>
            {access.data?.permissions.includes('sales.manage') && <Button onClick={() => open()}>
              <Plus size={17} /> New invoice
            </Button>}
          </div>
          <Input
            aria-label="Search sales"
            placeholder="Search customer, car or registration"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {sales.isLoading && <p role="status">Loading sales…</p>}
          {(sales.isFetching && !sales.isFetchingNextPage) && !sales.isLoading && <p role="status">Refreshing sales…</p>}
          {openingId && <p role="status">Opening the complete sale…</p>}
          {problem && <p role="alert">{problem}</p>}
          {sales.isError && (
            <p role="alert">
              Sales could not be loaded.{" "}
              <Button onClick={() => void sales.refetch()} variant="outline">
                Retry
              </Button>
            </p>
          )}
          {message && <p className="invoice-message" role="status">{message}</p>}
          <div className="invoice-sale-list">
            {matchingSales.map((sale) => { const progress = saleListProgress(sale); return (
                <button key={sale.id} data-sale-status={sale.completedAt ? 'sold' : sale.lifecycle?.status === 'reserved' ? 'reserved' : 'in-progress'} aria-busy={openingId === sale.id} onClick={() => void open(sale)}>
                  <span>
                    <strong>{sale.draft.customer || "Customer to add"}</strong>
                    <small>
                      {sale.draft.vehicle}{" "}
                      {sale.draft.registration &&
                        `· ${sale.draft.registration}`}
                    </small>
                    <small className="invoice-list-next">Next: {progress.action}</small>
                  </span>
                  <span>
                    <strong>
                      {saleMoney(
                        typeof sale.listTotalDue === 'number' ? sale.listTotalDue : saleWorkspaceTotals(sale.draft, sale.payments).totalDue,
                      )}
                    </strong>
                    <small>{progress.status}</small>
                    {sale.lifecycle?.status !== 'released' && sale.listLedgerKnown !== false && typeof progress.balance === 'number' && <small>{progress.correctionReview ? 'Calculated balance (review)' : progress.balance < 0 ? 'Customer credit' : 'Balance due'}: {saleMoney(progress.correctionReview ? progress.balance : Math.abs(progress.balance))}</small>}
                    {sale.lifecycle?.status === 'released' && typeof sale.listPaid === 'number' && sale.listPaid !== 0 && <small>{sale.listPaid < 0 ? 'Net paid out' : 'Net received'}: {saleMoney(Math.abs(sale.listPaid))}</small>}
                    {sale.lifecycle?.status === 'released' && typeof sale.listPending === 'number' && sale.listPending > 0 && <small>Pending: {saleMoney(sale.listPending)}</small>}
                    {sale.lifecycle?.status !== 'released' && progress.handover && <small>{progress.handover.method === 'delivery' ? 'Delivery' : 'Collection'}: {progress.handover.status}</small>}
                  </span>
                  <ArrowRight size={18} />
                </button>
              ); })}
          </div>
          {sales.hasNextPage && <Button variant="outline" disabled={sales.isFetchingNextPage || sales.isFetching} onClick={() => void sales.fetchNextPage()}>{sales.isFetchingNextPage ? 'Loading more sales…' : 'Load more sales'}</Button>}
          {!sales.isLoading && !sales.isError && Boolean(listSearch) && !matchingSales.length && (
            <div className="invoice-empty" role="status">
              <h2>No matching sales</h2>
              <p>Try another customer, car or registration.</p>
            </div>
          )}
          {!sales.isLoading && !sales.isError && !listSearch && !matchingSales.length && (
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
                  <dl className="invoice-resume-totals" aria-label="Sale amounts"><div><dt>Agreed total</dt><dd>{saleMoney(total.totalDue)}</dd></div><div><dt>Paid</dt><dd>{saleMoney(total.confirmedPaid)}</dd></div>{record.lifecycle?.status !== 'released' && <div data-balance={total.balance === 0 ? "settled" : "due"}><dt>{needsCorrectionReview ? "Calculated balance (review)" : total.balance < 0 ? "Customer credit" : "Balance due"}</dt><dd>{saleMoney(needsCorrectionReview ? total.balance : Math.abs(total.balance))}</dd></div>}</dl>
                  {needsCorrectionReview && <p role="alert" className="invoice-error">{record.lifecycle?.status === 'released' ? 'This released sale has a correction note. Check the external paperwork with your accountant.' : 'This sale has a recorded refund or correction note. The calculated balance uses the price recorded here and does not include external price corrections. Check with your accountant before treating it as money owed.'}</p>}
                  {record.lifecycle?.status === 'released' && <p className="invoice-note">The reservation was released and the sale is not completed. The agreed price above is retained for the record. To sell this car, return to sales and start a new invoice.</p>}
                  {record.lifecycle?.status === 'released' && (total.confirmedPaid !== 0 || total.pending > 0) && <p role="alert" className="invoice-error">Review the recorded payments and any provider refund status for this released reservation. {total.confirmedPaid !== 0 && `${total.confirmedPaid < 0 ? 'Net paid out' : 'Net received'}: ${saleMoney(Math.abs(total.confirmedPaid))}. `}{total.pending > 0 && `Pending: ${saleMoney(total.pending)}. `}These amounts do not mean the purchase price is due.</p>}
                  {record.lifecycle?.status !== 'released' && <SaleHandover key={`handover:${record.id}`} sale={record} onSaved={sale => accept({sale})} />}
                  {resumeAction && <div className="invoice-resume-next"><div><strong>Pick up where you left off</strong><p>{resumeAction.note}</p></div><Button disabled={busy} onClick={resumeAction.run}>{resumeAction.label}<ArrowRight size={16} aria-hidden="true" /></Button></div>}
                  <div className="invoice-resume-records">
                    <section aria-labelledby="resume-payments-heading"><h2 id="resume-payments-heading">Payment history</h2><p>{rows.length ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"} recorded` : "No payments recorded yet."}</p>{latestPayment && <small>Latest: {saleMoney(latestPayment.signedAmountPence)} · {paymentDate(latestPayment.date)} · {latestPayment.method}</small>}{total.pending > 0 && <small>{saleMoney(total.pending)} pending — not yet received.</small>}{record.lifecycle?.status !== 'released' && <Button variant="outline" disabled={busy} onClick={() => resumeAt(2)}>Record payment</Button>}</section>
                    <section aria-labelledby="resume-invoice-heading"><h2 id="resume-invoice-heading">Invoice</h2>{latestInvoice ? <><p>{latestInvoice.title} · {latestInvoice.number}</p><small>Issued {new Date(latestInvoice.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{!invoiceIsCurrent ? " · Changes since issue" : ""}</small><Button variant="outline" disabled={busy} onClick={() => documentAction(latestInvoice, "print")}>Open invoice</Button><Button variant="outline" disabled={busy} onClick={() => prepareDocumentEmail(latestInvoice)}>Invoice options</Button></> : <p>No invoice created yet.</p>}{record.completedAt && <small>A new sales invoice is not a credit note and does not correct the agreed sale price.</small>}{record.lifecycle?.status !== 'released' && <Button variant="ghost" disabled={busy} onClick={() => resumeAt(3)}>{latestInvoice ? record.completedAt ? "Create updated sales invoice" : "Create another invoice" : "Prepare invoice"}</Button>}</section>
                  </div>
                  {record.lifecycle?.status === 'reserved' && !record.completedAt && access.data?.permissions.includes('sales.manage') && <div className="invoice-draft-delete"><div><strong>Reservation</strong><p>{total.confirmedPaid !== 0 || total.pending !== 0 ? 'Review any received or pending payments before releasing this car.' : 'Payments are clear. You can release the car if this sale will not proceed.'}</p></div><Button variant="outline" disabled={busy || dirty || total.confirmedPaid !== 0 || total.pending !== 0} onClick={() => { setProblem(''); setReleaseReservationOpen(true); }}>Release reservation</Button></div>}
                  {rows.length > 0 && <section className="invoice-summary-payments" aria-label="Recorded payments"><ul>{rows.map(row => <li key={row.id} data-status={row.status}><div><strong>{saleMoney(row.signedAmountPence)}</strong><span>{paymentDate(row.date)} · {row.method}</span></div><small>{row.status === "confirmed" ? row.signedAmountPence < 0 ? "Returned / reversed" : "Received" : row.status}{row.reference && ` · ${row.reference}`}</small></li>)}</ul></section>}
                  {record.lifecycle?.status !== 'released' && <div className="invoice-resume-edit"><span>{record.completedAt ? "Completed details are locked. Issued invoices remain unchanged." : "Need to correct something?"}</span><Button variant="ghost" disabled={busy} onClick={() => resumeAt(0)}>{(record.completedAt || !canManageSales) ? "View vehicle details" : "Edit vehicle & price"}</Button><Button variant="ghost" disabled={busy} onClick={() => resumeAt(1)}>{(record.completedAt || !canManageSales) ? "View customer details" : "Edit customer details"}</Button></div>}
                  {canDeleteDraft && <div className="invoice-draft-delete"><div><strong>{record.draft.customer ? 'Test sale draft' : 'Unused sale draft'}</strong><p>No invoice or payment has been recorded. {dirty ? 'Save or discard your unsaved changes before deleting.' : 'You can remove this draft if it is no longer needed.'}</p></div><Button variant="outline" disabled={busy || dirty} onClick={() => { setProblem(''); setDeleteDraftOpen(true); }}><Trash2 size={16} aria-hidden="true" />Delete draft</Button></div>}
                  {(record.completedAt || record.lifecycle?.status === 'sold') && <><SoldVehicleCustomerReview saleId={record.id} /></>}
                  {record.documents.length > 1 && <details className="invoice-resume-paperwork"><summary>All saved paperwork ({record.documents.length})</summary>{[...record.documents].reverse().map(document => <div key={document.id}><span>{document.title}<small>{document.number}</small></span><Button variant="outline" size="sm" disabled={busy} onClick={() => documentAction(document, "print")}>Open {document.number}</Button></div>)}</details>}
                  {(record.completedAt || latestInvoice) && <CompletedSaleCorrectionHelp
                    key={record.id}
                    completed={Boolean(record.completedAt)}
                    corrections={record.corrections}
                    instructions={correctionPaperwork.data?.correctionSettings?.instructions}
                    instructionsError={correctionPaperwork.isError}
                    onRetryInstructions={() => void correctionPaperwork.refetch()}
                    canRecord={Boolean(access.data?.permissions.includes('sales.manage'))}
                    disabled={busy || dirty}
                    onRecord={async input => {
                      if (lock.current) throw new Error('Another sale action is in progress.');
                      lock.current = true;
                      setBusy(true);
                      try {
                        const result = await request(`/api/sale-workspace/${record.id}/corrections`, 'POST', { expectedRevision: record.revision, ...input });
                        accept(result);
                      } catch (error) {
                        if (error instanceof HttpApiError && error.data && typeof error.data === 'object' && 'error' in error.data) throw new Error(String(error.data.error));
                        throw error;
                      } finally { lock.current = false; setBusy(false); }
                    }}
                  />}
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
                      disabled={busy || !canEmailCustomer || !issued.snapshot.draft.email}
                      aria-describedby={!canEmailCustomer ? emailAvailabilityId : undefined}
                      onClick={() => email(issued)}
                    >
                      <Mail size={17} /> Email customer
                    </Button>

                  </div>
                  {!canEmailCustomer && <div id={emailAvailabilityId} role="status" className="invoice-note"><p>{emailUnavailableReason}</p>{features.isError && <Button variant="outline" disabled={features.isFetching} onClick={() => void features.refetch()}>Retry email availability</Button>}</div>}
                  {record && <SaleHandover key={`handover:${record.id}`} sale={record} onSaved={sale => accept({sale})} />}

                  {issued.invoiceKind === 'full' && record && <SoldVehicleCustomerReview key={`sold-customers:${record.id}:${record.lifecycle?.status ?? 'draft'}`} saleId={record.id} />}
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
                <fieldset disabled={busy || (!canManageSales && step < 2)}>
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
                                vin: "",
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
                      {(enquiries.isError || sales.isError || customerSales.isError) && (
                        <p className="text-sm text-muted-foreground">Some recent customer details could not be loaded. You can still enter the customer’s details.</p>
                      )}
                      {(enquiries.isLoading || sales.isLoading || customerSales.isFetching) && (
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
                        <div className="invoice-field-wide"><AddressPostcodeHelper address={draft.address} onChange={value => update('address',value)} disabled={!canManageSales || Boolean(record?.completedAt)} /></div>
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
                            <div>
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
                            {canManageSales && <div className="mt-2"><PartExchangeMotCheck registration={row.registration}/></div>}
                            </div>
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
                          <span>{needsCorrectionReview ? 'Calculated balance (review)' : 'Balance due'}</span>
                          <strong>{saleMoney(total!.balance)}</strong>
                        </div>
                      </div>
                      {needsCorrectionReview && <p role="alert" className="invoice-error">This calculation uses the price recorded here and does not include external price corrections. Check with your accountant before treating it as money owed.</p>}
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
                                  {row.status === 'confirmed' && row.kind === 'refund' ? 'Refund recorded' : row.status === 'confirmed' && row.signedAmountPence < 0 ? 'Correction recorded' : row.status}
                                  {row.reference && ` · ${row.reference}`}
                                  {row.reason && ` · ${row.reason}`}
                                </small>
                              </span>
                              {access.data?.permissions.includes('payments.refund') && row.status !== "cancelled" &&
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
                        <p className="invoice-note">Confirm the VIN from the vehicle or log book.</p>
                        <label>VIN / chassis number
                          <Input value={draft.vin ?? ""} maxLength={17} autoComplete="off" spellCheck={false}
                            disabled={!canManageSales || Boolean(record?.completedAt)} placeholder="17-character VIN"
                            onChange={event => update("vin", event.target.value.toUpperCase().replace(/\s/g, ""))} />
                          <small>Copy from the vehicle or log book. Leave blank if not available yet.</small>
                        </label>

                      </section>}
                      <SaleHandoverFields draft={draft} value={handoverDefaults(draft)} onChange={value => update('fulfilment',value)} disabled={!canManageSales || Boolean(record?.draft.fulfilment?.completedAt)} />
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
      {deleteDraftOpen && record && <Dialog open onOpenChange={open => { if (!busy && !open) { setDeleteDraftOpen(false); setProblem(''); } }}>
        <DialogContent className="z-[90]" overlayClassName="z-[89]" onOpenAutoFocus={event => { event.preventDefault(); document.getElementById('keep-sale-draft')?.focus(); }}>
          <DialogHeader><DialogTitle>Delete this draft?</DialogTitle><DialogDescription>This permanently removes only this unused or clearly labelled test draft. Invoices, payments, stock and customer enquiry records are kept.</DialogDescription></DialogHeader>
          <p>{record.draft.customer || 'No customer added'}{record.draft.vehicle ? ` — ${record.draft.vehicle}` : ''}</p>
          {problem && <div><p role="alert">{problem}</p><Button variant="outline" disabled={busy} onClick={() => run(async () => {
            const latest = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${record.id}`);
            setDeleteDraftOpen(false); accept({ sale: latest.sale }); setMessage('Latest draft loaded. Review it before deleting.');
          })}>Reload saved sales</Button></div>}
          <DialogFooter className="gap-2 sm:gap-0"><Button id="keep-sale-draft" variant="outline" disabled={busy} onClick={() => { setDeleteDraftOpen(false); setProblem(''); }}>Keep draft</Button><Button variant="destructive" disabled={busy || !canDeleteDraft || dirty || Boolean(problem)} onClick={deleteSavedDraft}>{busy ? 'Deleting…' : 'Delete draft permanently'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>}
      {record && <Dialog open={releaseReservationOpen} onOpenChange={open => { if (!busy) setReleaseReservationOpen(open); }}>
        <DialogContent className="z-[90]" overlayClassName="z-[89]">
          <DialogHeader><DialogTitle>Release this reservation?</DialogTitle><DialogDescription>The reservation will be removed. The car may become available to customers if it is still in published stock. The sale, invoices and payment history will be kept. No message will be sent.</DialogDescription></DialogHeader>
          {problem && <p role="alert">{problem}</p>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setReleaseReservationOpen(false)}>Keep reserved</Button><Button disabled={busy || dirty || total?.confirmedPaid !== 0 || total?.pending !== 0} onClick={() => run(async () => {
            await command('/lifecycle', {status:'released'});
            setReleaseReservationOpen(false);
            setMessage('Reservation released. Check the car’s published stock status before promising it to another customer.');
            void client.invalidateQueries({queryKey:getGetStockQueryKey()}).catch(() => {});
          })}>{busy ? 'Releasing…' : 'Release reservation'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>}
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
                input.kind === 'refund' ? "Refund recorded. No money was sent by the system. Original invoices remain unchanged; check with your manager or accountant what further paperwork is appropriate." : "Payment correction recorded. Original invoices remain unchanged; check with your manager or accountant what further paperwork is appropriate.",
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
