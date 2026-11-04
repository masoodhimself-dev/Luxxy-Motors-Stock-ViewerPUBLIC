import {PartExchangeMotCheck} from '@/components/mot-history';
import { AddressPostcodeHelper } from '@/components/postcode-field';
import { SaleHandover, SaleHandoverFields, handoverDefaults } from '@/components/portal/sale-handover';
import { SaleChecklists } from '@/components/sales-demo/sale-checklists';
import { CompletedSaleCorrectionHelp } from '@/components/sales-demo/completed-sale-correction-help';
import { SoldVehicleCustomerReview } from '@/components/portal/sold-vehicle-customer-review';
import { soldVehicleFollowUpsQueryKey } from '@/lib/sold-vehicle-follow-ups';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { useEnquirySummaries as useGetEnquiries } from "@/lib/enquiry-summary-query";
import { SaleVehiclePhoto } from '@/components/sales-demo/vehicle-choice';
import { VehicleChooser } from '@/components/vehicle-chooser';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import {
  getGetStockQueryKey,
} from "@workspace/api-client-react";
import {
  saleWorkspaceTotals,
  salePaymentRequestAvailable,
  salePaymentRequestRemaining,
  type SalePaymentRequest,
  saleCalculationFigures,
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
import { ConfirmSavedPayment } from '@/components/sales-demo/confirm-saved-payment';
import { SalePaymentRequests } from '@/components/sales-demo/sale-payment-requests';
import { SaleDeliveryEvidence } from '@/components/portal/sale-delivery-evidence';
import { SaleTermsDocuments } from '@/components/sale-terms-documents';
import { SaleDeliveryCharge } from '@/components/sales-demo/sale-delivery-charge';
import { SaleReturnReplace, SaleReplacementRefund } from '@/components/sales-demo/sale-return-replace';
import { SaleReturnCar } from '@/components/sales-demo/sale-return-car';
import { SalesActionMenu, SalesFlowSteps, saleActions, type SaleAction } from '@/components/sales-demo/sales-action-menu';
import { saleNextStep } from '@/components/sales-demo/sale-next-step';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { SaleProgress, SaleTimeline } from '@/components/sales-demo/sale-progress';
import { SalesPracticeWorkspace } from '@/components/sales-demo/sales-practice-workspace';
import { CalculationCheck, useSaleCalculationCheck } from '@/components/sales-demo/calculation-check';
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
  UserRound,
  History,
} from "@/components/icons";
import "@/sales-workspace.css";
import "./invoice-builder.css";
import "@/sales-workspace-v2.css";
import '@/sales-flow.css';
import type { SalesWorkspaceTab } from "@/components/sales-demo/workspace-navigation";

export interface SalesWorkspaceProps {
  embedded?: boolean;
  newSaleRequest?: number;
  newSaleVehicleId?: string | null;
  onExit?: () => void;
  quickActions?: ReactNode;
}
type SaleListRow = SaleWorkspaceRecord & { listSummary?: boolean; listStage?: string; listHasInvoice?: boolean; listTotalDue?: number; listPaid?: number; listPending?: number; listLedgerKnown?: boolean; listBalance?: number; listHasCorrectionNotes?: boolean; listHasRefunds?: boolean; listHandover?: { method: 'collection' | 'delivery'; status: string } | null };

/** List summaries deliberately contain totals, not customer payment details. */
function saleListProgress(sale: SaleListRow) {
  const handover = sale.listHandover;
  const balance = sale.listBalance;
  const correctionReview = Boolean(sale.listHasCorrectionNotes || sale.corrections?.length || (sale.completedAt && (sale.listHasRefunds || sale.payments?.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0))));
  const done = handover?.status === 'Collected' || handover?.status === 'Delivered';
  const status = sale.listStage || (sale.standaloneReturn ? 'Returned' : sale.returnReplacement?.direction === 'returned' ? 'Returned' : done ? handover!.status : sale.completedAt ? 'Sold' : sale.lifecycle?.status === 'reserved' ? 'Reserved' : sale.lifecycle?.status === 'released' ? 'Released' : 'In progress');
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
  newSaleVehicleId = null,
  onExit,
  quickActions,
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
  const canHandover = canManageSales || access.data?.permissions.includes('sales.handover') === true;
  const canRecordPayments = access.data?.permissions.includes('payments.record') === true;
  const canRefundPayments = access.data?.permissions.includes('payments.refund') === true;
  const [returnDraftDirty, setReturnDraftDirty] = useState(false);
  const [refundDraftDirty, setRefundDraftDirty] = useState(false);
  const [requestDraftDirty, setRequestDraftDirty] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
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
  const keepReservationRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [kind, setKind] = useState<"deposit" | "full">("full");
  const [step, setStep] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState<SalesWorkspaceTab>("deal");
  const [flowScreen, setFlowScreen] = useState<'car' | 'customer' | 'menu' | 'extras' | 'history' | SaleAction>('car');
  const [returnChoice, setReturnChoice] = useState<'return' | 'replace' | null>(null);
  const [practice, setPractice] = useState(false);
  const calculation = useSaleCalculationCheck();
  const [dealSection, setDealSection] = useState<"vehicle" | "customer" | "extras">("vehicle");
  const [composeInvoice, setComposeInvoice] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [operationBusy, setBusy] = useState(false);
  const busy = operationBusy || childBusy;
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const [contactAutofillNotice, setContactAutofillNotice] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [issued, setIssued] = useState<SaleWorkspaceDocument | null>(null);
  const [soldChoice, setSoldChoice] = useState(false);
  const [outstandingAccepted, setOutstandingAccepted] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<SaleWorkspacePayment | null>(null);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [duplicateAccepted, setDuplicateAccepted] = useState(false);
  const [depositConfirmOpen, setDepositConfirmOpen] = useState(false);
  const [depositRequestId, setDepositRequestId] = useState<string>();
  const [confirmationDocument, setConfirmationDocument] = useState<SaleWorkspaceDocument | null>(null);
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
  const dirty = detailsDirty || Boolean(payment.amount.trim()) || returnDraftDirty || refundDraftDirty || requestDraftDirty;
  const canDeleteDraft = Boolean(record?.emptyDraftDeletable && access.data?.permissions.includes('sales.manage'));
  const rows = record?.payments ?? [];
  const total = draft
    ? saleWorkspaceTotals(draft as SaleWorkspaceDraft, rows)
    : null;
  const calculationKey = JSON.stringify([record?.id, draft ? saleCalculationFigures(draft as SaleWorkspaceDraft) : null, rows, draft?.creditEntries, draft?.returnCreditPence]);
  useEffect(() => { calculation.reset(); }, [calculationKey, calculation.reset]);
  const vehicle = stock?.cars.find((car) => car.id === draft?.vehicleId);
  const accountingDraft = draft as SaleWorkspaceDraft | null;
  const deliveryAmount = pence(accountingDraft?.deliveryCharge ?? '');
  const returnedCredit = accountingDraft?.returnCreditPence ?? 0;
  const transferredCredit = (accountingDraft?.creditEntries ?? []).reduce((sum, credit) => sum + credit.signedAmountPence, 0);
  const actualPaymentsReceived = total ? total.confirmedPaid - transferredCredit : 0;
  const otherAdjustments = total ? total.adjustments - deliveryAmount + returnedCredit : 0;
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
    setPendingConfirmation(null); setDuplicateConfirmOpen(false); setDuplicateAccepted(false);
    setDepositConfirmOpen(false); setDepositRequestId(undefined); setConfirmationDocument(null);
    setRecord(saved ?? null);
    setDraft(initial ?? (saved ? structuredClone(saved.draft) : emptyDraft()));
    setStep(saved?.draft.vehicleId ? 1 : 0);
    setShowSummary(false);
    setWorkspaceTab("deal");
    setDealSection(saved?.draft.vehicleId ? "customer" : "vehicle");
    const starting = initial ?? saved?.draft;
    setFlowScreen(starting?.vehicleId ? starting.customer?.trim() ? 'menu' : 'customer' : 'car');
    setReturnChoice(null);
    if (starting?.vehicleId) { setDealSection('customer'); setStep(1); }
    setComposeInvoice(false);
    setPaymentFormOpen(false);
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
    if (lock.current || busy || (!saved && !canManageSales)) return;
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
    if (newSaleRequest <= 0 || newSaleRequest === consumedNew.current || busy || !access.data) return;
    if (newSaleVehicleId && stockLoading) return;
    consumedNew.current = newSaleRequest;
    if (newSaleVehicleId) {
      const car = stock?.cars.find(item => item.id === newSaleVehicleId);
      if (!canManageSales) { setProblem('You do not have permission to start a sale.'); return; }
      if (stockError || !stock) { setProblem('Current stock could not be loaded. Refresh Cars before starting this sale.'); return; }
      if (!car || car.inventoryStatus !== 'available') { setProblem('This car is no longer available. Refresh Cars and choose another vehicle.'); return; }
      open(undefined, { ...emptyDraft(), vehicleId: car.id, vehicle: vehicleDisplayTitle(car), registration: vehicleRegistration(car), price: car.price != null ? String(car.price) : '' });
    } else open();
  }, [newSaleRequest, newSaleVehicleId, stockLoading, stockError, stock, canManageSales, busy, access.data]);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (embedded && params.get('section') !== 'sales') return;
    const id = params.get('saleId'), enquiryId = params.get('enquiryId'), reservationId = params.get('reservationId');
    const key = [id, enquiryId, reservationId].join(':');
    if (key === '::' || key === consumed.current || busy || lock.current || (!id && enquiries.isLoading)) return;
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
  }, [search, enquiries.data, enquiries.isLoading, stock, stockLoading, stockError, busy]);
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
  }, [step, workspaceTab, dealSection, flowScreen, Boolean(draft), Boolean(issued), showSummary]);
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
    onReviewIntake={() => { setFlowScreen('extras'); setWorkspaceTab('deal'); setDealSection('extras'); setIssued(null); setShowSummary(false); setStep(0); setProblem(''); }} /> : null;
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
  const similarPayment = rows.find(row => row.status === 'confirmed' && row.signedAmountPence === pence(payment.amount) && row.method === payment.method && row.date === payment.date && row.reference.trim() === payment.reference.trim());
  useEffect(() => { setDuplicateAccepted(false); }, [payment.amount, payment.method, payment.date, payment.reference]);
  const selectedDepositRequest = record?.paymentRequests?.find(request => request.id === depositRequestId);
  const depositShortfall = record && selectedDepositRequest ? Math.max(0, salePaymentRequestRemaining(record, selectedDepositRequest) - pence(payment.amount)) : 0;
  function recordPayment() {
    if (!canRecordPayments || (payment.kind === 'deposit' && !canManageSales) || !payment.received || !total || !(pence(payment.amount) > 0) || pence(payment.amount) > total.balance || !payment.date || (similarPayment && !duplicateAccepted)) return;
    run(async () => {
      const result = await command("/invoice-payments", {
        payment: { amount: payment.amount, method: payment.method, date: payment.date, reference: payment.reference,
          kind: payment.kind, status: "confirmed",
          ...(depositRequestId ? { paymentRequestId: depositRequestId } : {}),
          ...(payment.kind === 'deposit' ? { reserveConfirmed: true, acceptShortfall: depositShortfall > 0 } : {}),
        },
      });
      const received = pence(payment.amount);
      const updated = saleWorkspaceTotals(result.sale.draft, result.sale.payments);
      setPayment({ ...payment, amount: "", reference: "", received: false });
      setDepositConfirmOpen(false); setDuplicateConfirmOpen(false); setDuplicateAccepted(false); setDepositRequestId(undefined); setPaymentFormOpen(false);
      setReviewed(false);
      if (payment.kind === 'deposit') {
        setConfirmationDocument(result.document?.type === 'receipt' ? result.document : null);
        setMessage(`${saleMoney(received)} deposit recorded. Car reserved. ${saleMoney(updated.balance)} left to pay.`);
      } else setMessage(`${saleMoney(received)} payment recorded. ${saleMoney(updated.balance)} left to pay.`);
      // Refreshing stock must not turn a successfully recorded payment into a failed save.
      void client.invalidateQueries({ queryKey: getGetStockQueryKey() }).catch(() => {});
    });
  }
  function addPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!payment.received || !total || !(pence(payment.amount) > 0) || pence(payment.amount) > total.balance || !payment.date) return;
    if (payment.kind === 'deposit') { setDepositConfirmOpen(true); return; }
    if (similarPayment) { setDuplicateConfirmOpen(true); return; }
    recordPayment();
  }
  function generate() {
    run(async () => {
      if (!draft) return;
      const issues = errors({ ...draft, payments: rows }, record?.draft);
      if (issues.length) throw new Error(issues.join(" "));
      const saved = await saveInternal();
      await calculation.check(saved, draft as SaleWorkspaceDraft);
      const result = await request(`/api/sale-workspace/${saved.id}/issue-invoice`, 'POST', {
        expectedRevision: saved.revision, kind, acknowledge: reviewed,
      });
      accept(result);
      setWorkspaceTab("invoices");
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
          ? doc.type === "receipt" ? "Deposit confirmation emailed to the customer." : "Document emailed to the customer."
          : delivery?.status === "prepared"
            ? "Email prepared. Enable Resend in settings to send it."
            : delivery?.error || "Email status updated.",
      );
    });
  }
  function prepareDocumentEmail(doc: SaleWorkspaceDocument) {
    setIssued(doc);
    setWorkspaceTab("invoices");
    setFlowScreen('invoice');
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
  const nextStep = record ? saleNextStep(record) : null;
  const latestInvoice = record?.documents.filter(document => document.type === "invoice").at(-1) ?? null;
  const needsCorrectionReview = !record?.standaloneReturn && Boolean(record?.corrections?.length || (record?.completedAt && rows.some(row => row.status === 'confirmed' && row.signedAmountPence < 0)));
  const invoiceIsCurrent = Boolean(latestInvoice && draft && saleInvoiceIsCurrent(latestInvoice, draft, rows));
  const latestPayment = rows.filter(row => row.status === "confirmed").at(-1);
  const saleStatus = record?.returnReplacement?.direction === "returned" ? "Returned" : record?.completedAt ? "Sold" : record?.lifecycle?.status === "reserved" ? "Reserved" : record?.lifecycle?.status === "released" ? "Released" : "In progress";
  function resumeAt(nextStep: number) {
    setFlowScreen(nextStep === 0 ? 'car' : nextStep === 1 ? 'customer' : nextStep === 2 ? 'payment' : 'invoice');
    setWorkspaceTab(nextStep === 2 ? "payments" : nextStep >= 3 ? "invoices" : "deal");
    setDealSection(nextStep === 1 ? "customer" : "vehicle");
    if (nextStep >= 3) setComposeInvoice(true);
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


  const sectionTitles = { deal: 'Deal details', payments: 'Payments', invoices: 'Invoices & documents', handover: 'Collection & delivery' };
  function changeSection(tab: SalesWorkspaceTab) {
    setWorkspaceTab(tab);
    setFlowScreen(tab === 'payments' ? 'payment' : tab === 'invoices' ? 'invoice' : tab === 'handover' ? 'handover' : dealSection === 'customer' ? 'customer' : 'car');
    setStep(tab === 'payments' ? 2 : tab === 'invoices' ? 4 : dealSection === 'customer' ? 1 : 0);
    setProblem('');
  }
  const released = record?.lifecycle?.status === 'released';
  const frozen = Boolean(record?.completedAt || released || !canManageSales);
  const returned = record?.lifecycle?.status === 'returned' || record?.returnReplacement?.direction === 'returned';
  const canChangeAction = () => !busy && (!(returnDraftDirty || refundDraftDirty || requestDraftDirty) || window.confirm('Leave this unfinished action? Its unsaved details will be lost.'));
  const showMenu = () => { setConfirmationDocument(null); setFlowScreen('menu'); setWorkspaceTab('deal'); setIssued(null); setProblem(''); };
  const goToMenu = () => { if (canChangeAction()) showMenu(); };
  function chooseAction(action: SaleAction) {
    if (!draft || !canChangeAction()) return;
    if ((action === 'deposit' || action === 'payment') && payment.amount.trim()) {
      setFlowScreen(payment.kind === 'deposit' ? 'deposit' : 'payment'); setWorkspaceTab('payments'); setPaymentFormOpen(true); setIssued(null); setConfirmationDocument(null);
      setProblem((action === 'deposit') !== (payment.kind === 'deposit') ? 'Finish or clear this payment before starting a different one.' : '');
      return;
    }
    setFlowScreen(action); setProblem(''); setIssued(null); setReviewed(false); setConfirmationDocument(null);
    if (action === 'request') { setWorkspaceTab('payments'); setPaymentFormOpen(false); }
    if (action === 'deposit' || action === 'payment') {
      setWorkspaceTab('payments'); setPaymentFormOpen(true);
      const openRequest = action === 'deposit' ? [...(record?.paymentRequests ?? [])].reverse().find(request => request.kind === 'deposit' && salePaymentRequestAvailable(record!, request, new Date().toISOString()) && salePaymentRequestRemaining(record!, request) > 0) : undefined;
      setDepositRequestId(openRequest?.id);
      setPayment(current => ({ ...current, kind: action === 'deposit' ? 'deposit' : 'part-payment', amount: current.amount || (openRequest ? (Math.min(salePaymentRequestRemaining(record!, openRequest), total!.balance) / 100).toFixed(2) : ''), received: false }));
    }
    if (action === 'invoice') { setWorkspaceTab('invoices'); setComposeInvoice(true); setKind('full'); }
    if (action === 'handover') setWorkspaceTab('handover');
    if (action === 'return') { setWorkspaceTab('deal'); setReturnChoice(record?.standaloneReturn ? 'return' : record?.returnReplacement?.direction === 'returned' ? 'replace' : null); }
  }
  function recordRequestedDeposit(request: SalePaymentRequest) {
    if (!record || !canRecordPayments || (request.kind === 'deposit' && !canManageSales) || !canChangeAction()) return;
    if (payment.amount.trim()) { chooseAction(payment.kind === 'deposit' ? 'deposit' : 'payment'); setProblem('Finish or clear this payment before starting another.'); return; }
    chooseAction(request.kind === 'deposit' ? 'deposit' : 'payment'); setDepositRequestId(request.id);
    setPayment(current => ({ ...current, kind: request.kind === 'deposit' ? 'deposit' : 'part-payment', amount: (Math.min(salePaymentRequestRemaining(record, request), total!.balance) / 100).toFixed(2), reference: request.reference, received: false }));
  }
  function followNextStep() {
    if (!nextStep || !record) return;
    if (nextStep.action === 'confirmation') {
      setConfirmationDocument(record.documents.find(doc => doc.id === nextStep.documentId) ?? null);
      setFlowScreen('deposit'); setPaymentFormOpen(false); return;
    }
    if ((nextStep.action === 'deposit' || nextStep.action === 'payment') && nextStep.requestId) {
      const request = record.paymentRequests?.find(row => row.id === nextStep.requestId);
      if (request) recordRequestedDeposit(request); return;
    }
    if (nextStep.action === 'history') { setFlowScreen('history'); setWorkspaceTab('payments'); setPaymentFormOpen(false); return; }
    chooseAction(nextStep.action);
  }
  const editSetup = (selected: 'car' | 'customer' | 'extras') => { if (!canChangeAction()) return; setFlowScreen(selected); setWorkspaceTab('deal'); setDealSection(selected === 'car' ? 'vehicle' : selected); setStep(selected === 'customer' ? 1 : 0); };
  const continueSetup = () => {
    if (!draft) return;
    const issues = errors({ ...draft, customer: flowScreen === 'car' ? 'Customer' : draft.customer, payments: rows }, record?.draft);
    if (issues.length) { setProblem(issues.join(' ')); return; }
    if (flowScreen === 'car') editSetup('customer');
    else run(async () => { await saveInternal(); showMenu(); });
  };
  if (practice) return <SalesPracticeWorkspace cars={stock?.cars ?? []} dealer={settings} onExit={() => setPractice(false)} quickActions={quickActions} />;
  return <div className={`invoice-builder sale-desk sales-flow${draft ? ' is-editing' : ''}`} data-sale-section={workspaceTab} data-flow-screen={flowScreen}>
    <header className="invoice-builder-header sale-desk-header">
      <div className="sale-desk-header-identity">
        <Button type="button" variant="ghost" aria-label={draft ? 'Back to sales' : 'Back to workspace'} disabled={busy} onClick={draft ? leave : () => onExit ? onExit() : navigate('/portal')}><ArrowLeft size={17} /><span>{draft ? 'Sales' : 'Workspace'}</span></Button>
        {(isMultiChoiceWebsite() || settings.identity.logoAsset) ? <img className="sales-flow-logo" src={isMultiChoiceWebsite() ? '/brand/multi-choice-motors/multi-choice-wordmark.svg' : settings.identity.logoAsset} alt={settings.identity.name} /> : <strong>{settings.identity.name}</strong>}
        {draft && <span className="sale-desk-save-status" role="status">{busy ? 'Working…' : detailsDirty ? 'Unsaved changes' : returnDraftDirty ? 'Return not confirmed' : refundDraftDirty ? 'Refund not recorded' : record ? 'Saved' : 'Not saved yet'}</span>}
      </div>
      <div className="sale-desk-header-actions">
        {draft && canManageSales && <Button variant={detailsDirty ? 'default' : 'outline'} disabled={busy || (!detailsDirty && Boolean(record))} onClick={save}>{busy ? 'Saving…' : 'Save details'}</Button>}
        {quickActions}
      </div>
    </header>
    {!draft ? <main className="invoice-builder-list sale-desk-list">
          <div className="invoice-list-heading">
            <div>
              <h1>Sales</h1>
              <p>
                {access.data?.permissions.includes('sales.manage') ? 'Manage each deal, from the first deposit to the handover.' : 'View existing sales, invoices and payments.'}
              </p>
            </div>
            {access.data?.permissions.includes('sales.manage') && <div className="sales-flow-list-actions"><Button variant="outline" disabled={stockLoading || !!stockError || !stock?.cars.length} onClick={() => setPractice(true)}>Try with a real car</Button><Button onClick={() => open()}>
              <Plus size={17} /> New sale
            </Button></div>}
          </div>
          <Input
            aria-label="Search sales"
            placeholder="Find by customer, car, registration or invoice number"
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
              <h2>Start your first sale</h2>
              <p>
                Choose a customer and car, record the payments, then create the
                paperwork.
              </p>
            </div>
          )}</main> : <>
      <SalesFlowSteps step={flowScreen === 'car' ? 0 : flowScreen === 'customer' ? 1 : 2} disabled={busy}
        onChoose={selected => selected === 0 ? editSetup('car') : selected === 1 ? editSetup('customer') : goToMenu()} />
      <main className="sale-desk-body" ref={scrollPane}>
        {draft.vehicleId && flowScreen !== 'car' && <div className="sales-flow-context">
          <div>{vehicle && <SaleVehiclePhoto car={vehicle} />}<span><strong>{draft.vehicle}</strong><small>{draft.registration} · {saleMoney(pence(draft.price))}</small></span><Button variant="ghost" disabled={busy} onClick={() => editSetup('car')}>Change</Button></div>
          <div><UserRound size={24} aria-hidden="true"/><span><strong>{draft.customer || 'Choose customer'}</strong><small>{record?.reference || 'New sale'}</small></span><Button variant="ghost" disabled={busy} onClick={() => editSetup('customer')}>Change</Button></div>
          <SaleProgress sale={record} />
        </div>}
        <div className="sale-desk-content" id="sale-flow-content">
          <div className="sale-desk-section-heading"><div><h1 ref={heading} tabIndex={-1}>{flowScreen === 'car' ? 'Choose a car' : flowScreen === 'customer' ? 'Choose the customer' : flowScreen === 'menu' ? 'What would you like to do?' : flowScreen === 'extras' ? 'Extras and part exchange' : flowScreen === 'history' ? 'Payments and documents' : saleActions.find(action => action.id === flowScreen)?.title}</h1>{flowScreen === 'menu' && <p>Start with the next step, or choose another action.</p>}</div>{!['car','customer','menu'].includes(flowScreen) && <Button variant="ghost" disabled={busy} onClick={goToMenu}><ArrowLeft size={16}/>All actions</Button>}</div>
          {problem && <div role="alert" className="invoice-error">{problem}{/another device|reload/i.test(problem) && record && <Button variant="outline" disabled={busy} onClick={() => run(async () => {const latest = await customFetch<{sale: SaleWorkspaceRecord}>(`/api/sale-workspace/${record.id}`);accept({sale: latest.sale});setMessage('Latest sale loaded.');})}>Reload latest sale</Button>}</div>}
          {message && <p role="status" className="invoice-message">{message}</p>}
          {released && <p className="invoice-message" data-tone="warning">This reservation was released. Its documents and payment history are kept. Start a new sale to sell this car.</p>}
          {released && total && (total.confirmedPaid !== 0 || total.pending > 0) && <p role="alert" className="invoice-error">Review this released reservation’s payments. {total.confirmedPaid !== 0 && `Net received: ${saleMoney(total.confirmedPaid)}. `}{total.pending > 0 && `Pending: ${saleMoney(total.pending)}. `}These amounts do not mean the purchase price is due.</p>}
          {needsCorrectionReview && <p role="alert" className="invoice-error">This sale has refunds or external corrections. Review the original paperwork before relying on the calculated balance.</p>}
          {nextStep && (flowScreen === 'menu' || (['deposit','payment'].includes(flowScreen) && !paymentFormOpen && !confirmationDocument)) && <section className="sales-flow-next" aria-label="Next step"><div><strong>Next step</strong><p>{nextStep.note}</p></div><Button disabled={busy || (['deposit','payment','request','invoice','confirmation'].includes(nextStep.action) && !canRecordPayments) || (nextStep.action === 'handover' && !canHandover) || (nextStep.action === 'deposit' && !canManageSales)} onClick={followNextStep}>{nextStep.label}<ArrowRight size={20}/></Button></section>}
          {confirmationDocument && ['deposit','payment','menu'].includes(flowScreen) && <section className="sales-flow-confirmation" aria-label="Deposit confirmation"><h2><Check size={22}/>Let the customer know</h2><p>{saleMoney(confirmationDocument.paymentAmountPence ?? 0)} received for {draft.vehicle}. {record?.lifecycle?.status === 'reserved' ? 'The car is reserved.' : 'The payment has been recorded.'}</p><p>{confirmationDocument.snapshot.draft.email ? `Send the saved receipt to ${confirmationDocument.snapshot.draft.email}.` : 'Add an email address to send confirmation, or download the receipt.'}</p><div className="sales-flow-secondary"><Button disabled={busy || !canEmailCustomer || !confirmationDocument.snapshot.draft.email || record?.emailDeliveries?.some(row => row.documentId === confirmationDocument.id && row.status === 'sent')} onClick={() => email(confirmationDocument)}><Mail size={18}/>{record?.emailDeliveries?.some(row => row.documentId === confirmationDocument.id && row.status === 'sent') ? 'Confirmation sent' : 'Send deposit confirmation'}</Button><Button variant="outline" disabled={busy} onClick={() => documentAction(confirmationDocument,'download')}><Download size={18}/>Download receipt</Button><Button variant="ghost" disabled={busy} onClick={goToMenu}>Back to sale</Button></div>{!canEmailCustomer && <p>{emailUnavailableReason}</p>}</section>}
          {flowScreen === 'menu' && <><SalesActionMenu onChoose={chooseAction} disabled={busy} unavailable={{
            ...(!canRecordPayments ? { request: 'You can view this sale. Ask a manager to record payments.', deposit: 'Ask a manager to record a deposit.', payment: 'Ask a manager to record a payment.', invoice: 'Ask a manager to create an invoice.' } : {}),
            ...(returned || released ? { request: 'This sale is closed.', deposit: 'This sale is closed.', payment: 'This sale is closed.', invoice: 'Use the saved documents below.' } : {}),
            ...(!canManageSales ? { deposit: 'Ask a manager to reserve the car.' } : {}),
            ...(record?.completedAt ? { deposit: 'This car is already sold.' } : {}),
            ...(!canHandover ? { handover: 'Ask a manager to arrange the handover.' } : {}),
            ...(!(canManageSales && canRefundPayments) ? { return: 'Ask a manager to record a return.' } : {}),
          }} />
          <div className="sales-flow-secondary"><Button variant="ghost" disabled={busy} onClick={() => editSetup('extras')}><Plus size={16}/>Extras or part exchange</Button><Button variant="ghost" disabled={busy} onClick={() => {setFlowScreen('history');setWorkspaceTab('payments');setPaymentFormOpen(false);}}><History size={16}/>Payments and documents</Button></div>
          {record && <SaleTimeline sale={record}/>}</>}
          {workspaceTab === 'deal' && ['car', 'customer', 'extras'].includes(flowScreen) && <>
            <section className="sale-desk-sheet"><fieldset disabled={busy || frozen}>
              {dealSection === 'vehicle' && <>
                      <h2>Vehicle & agreed price</h2>
                      <VehicleChooser
                        cars={(stock?.cars ?? []).filter(car => car.id === draft.vehicleId || !["sold", "archived", "reserved", "hidden", "unavailable", "withdrawn"].includes(String(car.inventoryStatus)))}
                        value={draft.vehicleId}
                        savedLabel={draft.vehicle}
                        disabled={busy || !canManageSales || vehicleChangeLocked}
                        loading={stockLoading}
                        failed={Boolean(stockError)}
                        lockedReason={vehicleChangeLocked ? "The vehicle is locked to this reserved or completed sale." : undefined}
                        onChange={(id) => {
                          const car = stock?.cars.find(c => c.id === id);
                          if (car) setDraft({ ...draft, sourceEnquiryId: "", sourceReservationId: "", customerSource: "", vin: "", vehicleId: car.id, vehicle: vehicleDisplayTitle(car), registration: vehicleRegistration(car), price: car.price != null ? String(car.price) : "" });
                        }}
                      />
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
                <details className="sales-flow-optional"><summary>Add chassis number (optional)</summary><label className="sale-desk-vin">VIN / chassis number <Input value={draft.vin ?? ''} maxLength={17} spellCheck={false} autoComplete="off" placeholder="VIN from the vehicle or log book" onChange={event => update('vin',event.target.value.toUpperCase().replace(/\s/g,''))} /></label></details>
              </>}
              {dealSection === 'customer' && <>
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
                      </div></>}
              {dealSection === 'extras' && <><details className="invoice-optional" open>
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

                <label>For the customer<Textarea rows={3} value={draft.notes} onChange={event => update('notes', event.target.value)} /><small>Shown on the invoice.</small></label>
              </>}
            </fieldset>
            {dealSection === 'extras' && checklistPanel(true)}
            </section>
            <div className="sale-desk-section-actions"><Button onClick={continueSetup} disabled={busy}>{flowScreen === 'car' ? 'Choose customer' : 'Choose what to do'}<ArrowRight size={16}/></Button></div>
            {record && <details className="sale-desk-fold"><summary>Sale actions</summary>
              {record.lifecycle?.status === 'reserved' && !record.completedAt && canManageSales && <div className="invoice-draft-delete"><p>Release this reservation when received and pending payments are clear.</p><Button variant="outline" disabled={busy || dirty || total?.confirmedPaid !== 0 || total?.pending !== 0} onClick={() => {setProblem('');setReleaseReservationOpen(true);}}>Release reservation</Button></div>}
              {canDeleteDraft && <div className="invoice-draft-delete"><p>No issued invoice or payment is attached to this removable draft.</p><Button variant="outline" disabled={busy || dirty} onClick={() => {setProblem('');setDeleteDraftOpen(true);}}><Trash2 size={16}/>Delete draft</Button></div>}
              {!canDeleteDraft && record.lifecycle?.status !== 'reserved' && <p>Issued documents and payment history are retained with this sale.</p>}
            </details>}
          </>}
          {flowScreen === 'return' && <>
            {!record?.completedAt ? <section className="sale-desk-sheet"><h2>Find the original sale</h2><p>Choose the completed sale for the car being returned. Its customer, payments and invoice will be filled in.</p><Button onClick={() => {setDraft(null);setRecord(null);setFilter(draft.registration);setMessage('Find and open the original completed sale, then choose Return or change a car.');}}>Find the original sale</Button></section> : <>
            {!returnChoice && <div className="sales-flow-return-choices"><button type="button" onClick={() => setReturnChoice('return')}><strong>Return car</strong><span>Take the car back and work out any refund.</span></button><button type="button" onClick={() => setReturnChoice('replace')}><strong>Return and replace</strong><span>Use the agreed credit towards another car.</span></button></div>}
            {returnChoice === 'return' && <SaleReturnCar key={`return-car:${record.id}`} sale={record} initialExpanded onSaved={sale => accept({sale})} disabled={operationBusy || detailsDirty || Boolean(payment.amount.trim())} canReturn={canManageSales && canRefundPayments} canInspect={canManageSales} onDirtyChange={setReturnDraftDirty} onBusyChange={setChildBusy} onRefund={() => {setFlowScreen('history');setWorkspaceTab('payments');}}/>}
            {returnChoice === 'replace' && <SaleReturnReplace key={`return:${record.id}`} initialExpanded sale={record} cars={stock?.cars ?? []} onSaved={sale => accept({sale})} onOpenSale={id => void open({id})} disabled={operationBusy || detailsDirty || Boolean(payment.amount.trim())} canReturn={canManageSales && canRefundPayments} canInspect={canManageSales} onDirtyChange={setReturnDraftDirty} onBusyChange={setChildBusy}/>}
            </>}
          </>}
          {flowScreen === 'request' && canRecordPayments && (payment.amount.trim() ? <section className="sale-desk-sheet"><p>You have an unfinished payment. Save it if the money was received, or clear its amount before requesting a deposit.</p><Button disabled={busy} onClick={() => chooseAction(payment.kind === 'deposit' ? 'deposit' : 'payment')}>Return to unfinished payment</Button></section> : record && !detailsDirty ? <SalePaymentRequests sale={record} onSaved={sale=>accept({sale})} onDirtyChange={setRequestDraftDirty} onBusyChange={setChildBusy} onRecordDeposit={recordRequestedDeposit} showMoneySummary={false} canReserve={canManageSales} actionOnly /> : <section className="sale-desk-sheet"><p>Save the car and customer details to prepare the request.</p><Button disabled={busy} onClick={save}>Save and continue</Button></section>)}
          {record && canRefundPayments && flowScreen === 'history' && <SaleReplacementRefund key={`refund-credit:${record.id}`} sale={record} onSaved={sale => accept({sale})} disabled={operationBusy || detailsDirty || Boolean(payment.amount.trim())} onDirtyChange={setRefundDraftDirty} onBusyChange={setChildBusy}/>}
          {['payment', 'deposit', 'history'].includes(flowScreen) && <section className="sale-desk-sheet sale-desk-payments">
            {flowScreen === 'history' && <div className="sale-desk-inline-heading"><div><h2>Money received</h2></div>{total!.balance > 0 && canRecordPayments && !released && !returned && <Button onClick={() => chooseAction('payment')} disabled={busy}><Plus size={16}/>Take a payment</Button>}</div>}
            {!rows.length && flowScreen === 'history' && <p className="sale-desk-empty-inline">No payments recorded.</p>}
            {payment.amount.trim() && <p className="invoice-message">An unsaved payment is kept here. Save it before issuing documents or leaving this sale.</p>}
            <fieldset disabled={busy || !canRecordPayments || released || returned}>{rows.length > 0 && flowScreen === 'history' && (
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
                              {row.status === 'pending' && <Button variant="outline" disabled={busy || detailsDirty || Boolean(payment.amount.trim()) || (row.kind === 'deposit' && !canManageSales)} onClick={() => {setPendingConfirmation(row);setProblem('');}}>Confirm received</Button>}
                              {access.data?.permissions.includes('payments.refund') && row.status !== "cancelled" &&
                                row.signedAmountPence > 0 && (
                                  <Button
                                    variant="ghost"
                                    onClick={() => setReverse(row)}
                                  >
                                    {row.status === 'pending' ? 'Cancel pending payment' : 'Correct a payment'}
                                  </Button>
                                )}
                            </div>
                          ))}
                        </div>
                      )}
                      {total!.balance > 0 && paymentFormOpen && (
                        <form
                          className="invoice-payment-form"
                          onSubmit={addPayment}
                        >
                          <p>Check the money has arrived before saving.</p>
                          {selectedDepositRequest && <p className="sales-flow-requested">{selectedDepositRequest.kind === 'deposit' ? 'Deposit requested:' : 'Payment requested:'} <strong>{saleMoney(selectedDepositRequest.amountPence)}</strong> · {selectedDepositRequest.reference}</p>}
                          {selectedDepositRequest?.kind === 'deposit' && payment.kind === 'deposit' && pence(payment.amount) > 0 && depositShortfall > 0 && <p className="invoice-message" data-tone="warning">This is {saleMoney(depositShortfall)} less than requested. You can accept it as the deposit. The unpaid amount stays in the balance.</p>}
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
                                    received: false,
                                  })
                                }
                              />
                              <div className="sales-flow-amounts">{(flowScreen === 'deposit' ? [10000, 25000, 50000] : [total!.balance]).filter(value => value <= total!.balance).map(value => <button type="button" key={value} onClick={() => setPayment({...payment, amount:(value/100).toFixed(2), received:false})}>{flowScreen === 'payment' ? 'Full balance ' : ''}{saleMoney(value)}</button>)}</div>
                            </label>
                            <label>
                              Payment method
                              <select
                                value={payment.method}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    method: event.target.value,
                                    received: false,
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
                                    received: false,
                                  })
                                }
                              />
                            </label>
                            {flowScreen !== 'deposit' && <label>
                              Payment type
                              <select
                                value={payment.kind}
                                onChange={(event) =>
                                  setPayment({
                                    ...payment,
                                    kind: event.target
                                      .value as typeof payment.kind,
                                    received: false,
                                    amount:
                                      event.target.value === "final-payment"
                                        ? (total!.balance / 100).toFixed(2)
                                        : payment.amount,
                                  })
                                }
                              >
                                <option value="part-payment">
                                  Part payment
                                </option>
                                <option value="final-payment">
                                  Final payment
                                </option>
                              </select>
                            </label>}
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
                            {busy ? 'Saving…' : `Save ${payment.amount.trim() && pence(payment.amount) > 0 ? `${saleMoney(pence(payment.amount))} ` : ''}${flowScreen === 'deposit' ? 'deposit' : 'payment'}`}
                          </Button>
                        </form>
                      )}
                      {total!.balance === 0 && (
                        <p className="invoice-message" data-tone="success">
                          The agreed balance is settled.
                        </p>
                      )}</fieldset>
          </section>}
          {(flowScreen === 'invoice' || flowScreen === 'history') && <>
            {record && !detailsDirty && <details className="sale-desk-fold"><summary>Terms and conditions</summary><SaleTermsDocuments saleId={record.id} saleRevision={record.revision} canIssue={canManageSales && !busy && !payment.amount.trim()}/></details>}
            {issued ? <section className="sale-desk-sheet">
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


                  {issued.invoiceKind === 'full' && record && <SoldVehicleCustomerReview key={`sold-customers:${record.id}:${record.lifecycle?.status ?? 'draft'}`} saleId={record.id} />}
                  {issued.invoiceKind === "full" &&
                    !record?.completedAt && canManageSales &&
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
                              busy || Boolean(payment.amount.trim()) || detailsDirty ||
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
                      setWorkspaceTab("payments");
                      setFlowScreen("payment");
                      setStep(2);
                      setReviewed(false);
                    }}
                  >
                    Return to this sale
                  </Button></section> : <>
              <details className="sale-desk-fold" open={flowScreen === 'history' ? true : undefined}><summary>Saved documents ({record?.documents.length ?? 0})</summary><div className="sale-desk-inline-heading"><div><p>Issued paperwork keeps its original details.</p></div>{canRecordPayments && !released && !returned && flowScreen === 'history' && <Button onClick={() => chooseAction('invoice')} disabled={busy}><Plus size={16}/>Create invoice</Button>}</div>
                {record?.documents.length ? <div className="sale-desk-document-list">{[...record.documents].reverse().map(doc => <div key={doc.id}><Invoice size={19} aria-hidden="true"/><span><strong>{doc.title}</strong><small>{doc.number} · {new Date(doc.issuedAt).toLocaleDateString('en-GB')}</small></span><Button variant="outline" disabled={busy} onClick={() => {setIssued(doc);setSoldChoice(false);setOutstandingAccepted(false);}}>View & share</Button></div>)}</div> : <p className="sale-desk-empty-inline">No documents issued yet. Create an invoice when the deal details are ready.</p>}
              </details>
              {flowScreen === 'invoice' && canRecordPayments && !released && !returned && <section className="sale-desk-sheet sale-desk-invoice-compose"><h2>Invoice details</h2>
                <div className="sale-desk-invoice-kinds" role="group" aria-label="Invoice type">{(['full','deposit'] as const).map(type => <Button key={type} variant={kind === type ? 'default' : 'outline'} aria-pressed={kind === type} disabled={busy || (type === 'deposit' && Boolean(record?.completedAt))} onClick={() => {setKind(type);setReviewed(false);}}><Invoice size={16}/>{type === 'full' ? 'Sales invoice' : 'Received deposit invoice'}</Button>)}</div>
                {kind === 'deposit' && <p className="invoice-note">Use this after receiving a deposit.</p>}
                <div className="sales-flow-secondary"><Button variant="outline" onClick={() => editSetup('car')}>Edit price</Button><Button variant="outline" onClick={() => editSetup('customer')}>Edit customer</Button><Button variant="outline" onClick={() => editSetup('extras')}>Extras or part exchange</Button></div>
                <details className="sale-desk-fold"><summary>Review customer, vehicle and amounts</summary><dl className="invoice-review">
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
</details>
                <label className="invoice-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy || Boolean(payment.amount.trim())}/>I have checked the customer, vehicle, agreed price and received payments.</label>
                {payment.amount.trim() && <p className="invoice-error">Save or clear the payment entry in Payments before creating an invoice.</p>}
                <p className="invoice-note">Creating an invoice keeps the car’s current availability. You can mark it sold after reviewing the saved invoice.</p>
                <Button disabled={busy || !reviewed || Boolean(payment.amount.trim())} onClick={generate}><Invoice size={17}/>{busy ? 'Creating invoice…' : 'Create & save invoice'}</Button>
              </section>}
            </>}
            {record && (record.completedAt || latestInvoice) && <details className="sale-desk-fold"><summary>Corrections & supporting paperwork</summary><CompletedSaleCorrectionHelp
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
/></details>}
          </>}
          {workspaceTab === 'handover' && <>
            <div className="sales-flow-handover-status" aria-label="Handover status"><span><Check size={17}/>{total!.balance === 0 ? 'Paid in full' : `${saleMoney(Math.abs(total!.balance))} ${total!.balance < 0 ? 'to return' : 'still to pay'}`}</span><span><Invoice size={17}/>{latestInvoice?.invoiceKind === 'full' && invoiceIsCurrent ? 'Invoice ready' : 'Sales invoice needed'}</span></div>
            <section className="sale-desk-sheet">
              {payment.amount.trim() ? <p className="invoice-error">Save or clear the payment entry in Payments before confirming the handover.</p> : record && !detailsDirty ? <SaleHandover key={`handover:${record.id}`} sale={record} onSaved={sale => accept({sale})} /> : <><SaleHandoverFields draft={draft} value={handoverDefaults(draft)} onChange={value => update('fulfilment', value)} disabled={busy || !canManageSales || Boolean(record?.draft.fulfilment?.completedAt)}/><p className="invoice-note">Save these details to continue with the handover.</p><Button onClick={save} disabled={busy || !canManageSales}>Save arrangements</Button></>}
            </section>
            {record && !detailsDirty && !payment.amount.trim() && record.draft.fulfilment?.method==='delivery' && canManageSales && <><SaleDeliveryCharge sale={record} onSaved={sale=>accept({sale})} onBusyChange={setChildBusy}/><details className="sale-desk-fold"><summary>Delivery evidence and signed paperwork</summary><SaleDeliveryEvidence saleId={record.id} revision={record.revision}/></details></>}
            <details className="sale-desk-fold"><summary>Before handing over the car</summary>{checklistPanel()}</details>
            {record && (record.completedAt || record.lifecycle?.status === 'sold') && <details className="sale-desk-fold"><summary>Customer follow-up</summary><SoldVehicleCustomerReview saleId={record.id} /></details>}
          </>}
        </div>
        {total && !['car','customer'].includes(flowScreen) && <aside className="sales-flow-breakdown" aria-label="Payment breakdown">
          <details className="sales-flow-money-details" open={typeof window === 'undefined' || window.innerWidth > 760}><summary>Payment breakdown</summary><dl>
            <div><dt>Car price</dt><dd>{saleMoney(total.price)}</dd></div>
            {deliveryAmount !== 0 && <div><dt>Delivery</dt><dd>{saleMoney(deliveryAmount)}</dd></div>}
            {otherAdjustments !== 0 && <div><dt>Extras and discounts</dt><dd>{saleMoney(otherAdjustments)}</dd></div>}
            {total.allowance !== 0 && <div><dt>Part exchange</dt><dd>−{saleMoney(total.allowance)}</dd></div>}
            {returnedCredit !== 0 && <div><dt>Return credit</dt><dd>−{saleMoney(returnedCredit)}</dd></div>}
            <div className="sales-flow-breakdown-total"><dt>Agreed total</dt><dd>{saleMoney(total.totalDue)}</dd></div>
            <div data-tone="paid"><dt>Payments received</dt><dd>{saleMoney(actualPaymentsReceived)}</dd></div>
            {transferredCredit !== 0 && <div><dt>Transferred credit</dt><dd>{saleMoney(transferredCredit)}</dd></div>}
            {total.pending > 0 && <div><dt>Still to confirm</dt><dd>{saleMoney(total.pending)}</dd></div>}
            <div className="sales-flow-breakdown-balance" data-tone={total.balance === 0 ? 'paid' : 'due'}><dt>{needsCorrectionReview ? 'Balance to review' : released ? 'Closed sale balance' : total.balance < 0 ? 'To return' : 'Left to pay'}</dt><dd>{saleMoney(Math.abs(total.balance))}</dd></div>
          </dl>{total.pending > 0 && <p>Unconfirmed payments are not included in money received.</p>}
          <CalculationCheck result={calculation.result} busy={calculation.busy} error={calculation.error}/>
          </details>
        </aside>}
        {flowScreen === 'history' && record && <SaleTimeline sale={record}/>}

      </main>
      <footer className="sales-flow-footer">
        <Button variant="ghost" disabled={busy} onClick={flowScreen === 'menu' ? () => editSetup('customer') : flowScreen === 'car' ? leave : flowScreen === 'customer' ? () => editSetup('car') : goToMenu}><ArrowLeft size={16}/>{flowScreen === 'menu' ? 'Back to customer' : flowScreen === 'car' ? 'Back to sales' : flowScreen === 'customer' ? 'Back to car' : 'All actions'}</Button>
        {total && <div className="sales-flow-money" aria-label="Sale amounts"><span>Total <strong>{saleMoney(total.totalDue)}</strong></span><span>{transferredCredit ? 'Paid / credit' : 'Paid'} <strong>{saleMoney(total.confirmedPaid)}</strong></span><span>{needsCorrectionReview && !record?.standaloneReturn ? 'Balance to review' : released ? 'Closed sale balance' : total.balance < 0 ? 'To return' : 'Left to pay'} <strong>{saleMoney(Math.abs(total.balance))}</strong></span></div>}
        <small role="status">{busy ? 'Saving…' : detailsDirty ? 'Unsaved details' : record ? 'Saved' : 'Not saved yet'}</small>
      </footer>
    </>}
      {pendingConfirmation && record && <ConfirmSavedPayment key={pendingConfirmation.id} sale={record} payment={pendingConfirmation} busy={busy} problem={problem} onClose={() => {if (!busy) setPendingConfirmation(null);}} onConfirm={input => run(async () => {
        const confirmed = pendingConfirmation;
        const result = await command(`/payments/${confirmed.id}/confirm`, input);
        setPendingConfirmation(null);
        if (confirmed.kind === 'deposit' && result.document) {setConfirmationDocument(result.document);setFlowScreen('deposit');setPaymentFormOpen(false);}
        setMessage(`${saleMoney(confirmed.amountPence)} received${confirmed.kind === 'deposit' ? '. Car reserved' : ''}.`);
        void client.invalidateQueries({queryKey:getGetStockQueryKey()}).catch(() => {});
      })}/>}
      {duplicateConfirmOpen && <Dialog open onOpenChange={open => { if (!busy) setDuplicateConfirmOpen(open); }}><DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy}><DialogHeader><DialogTitle>Is this a separate payment?</DialogTitle><DialogDescription>A payment for {saleMoney(pence(payment.amount))} with the same date, method and reference is already recorded.</DialogDescription></DialogHeader><label className="invoice-check"><input type="checkbox" checked={duplicateAccepted} onChange={event => setDuplicateAccepted(event.target.checked)}/>This is a separate payment. Record it as well.</label><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDuplicateConfirmOpen(false)}>Go back</Button><Button disabled={busy || !duplicateAccepted} onClick={recordPayment}>Record separate payment</Button></DialogFooter>{problem && <p role="alert">{problem}</p>}</DialogContent></Dialog>}
      {depositConfirmOpen && draft && <Dialog open onOpenChange={open => { if (!busy) setDepositConfirmOpen(open); }}><DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy}>
        <DialogHeader><DialogTitle>Reserve this car for {draft.customer}?</DialogTitle><DialogDescription>You're recording a {saleMoney(pence(payment.amount))} deposit. Confirm that the money has arrived. This will reserve the vehicle and remove it from available stock.</DialogDescription></DialogHeader>
        <p><strong>{draft.vehicle}</strong> · {draft.registration}</p>
        {depositShortfall > 0 && <p className="invoice-message" data-tone="warning">Accept {saleMoney(pence(payment.amount))} instead of the {saleMoney(selectedDepositRequest!.amountPence)} requested. The remaining {saleMoney(depositShortfall)} stays in the balance; it is not a discount.</p>}
        <p>Connected sales channels update through their normal stock feed.</p>
        {similarPayment && <div className="invoice-message" data-tone="warning"><p>A payment with this amount, date, method and reference is already recorded.</p><label className="invoice-check"><input type="checkbox" checked={duplicateAccepted} onChange={event => setDuplicateAccepted(event.target.checked)}/>This is a separate payment. Record it as well.</label></div>}
        {problem && <p role="alert" className="invoice-error">{problem}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDepositConfirmOpen(false)}>Go back</Button><Button disabled={busy || !canRecordPayments || !canManageSales || Boolean(similarPayment && !duplicateAccepted)} onClick={recordPayment}>{busy ? 'Recording deposit…' : `Confirm ${saleMoney(pence(payment.amount))} & reserve car`}</Button></DialogFooter>
      </DialogContent></Dialog>}
      {deleteDraftOpen && record && <Dialog open onOpenChange={open => { if (!busy && !open) { setDeleteDraftOpen(false); setProblem(''); } }}>
        <DialogContent className="portal-action-dialog sales-action-dialog z-[90]" closeDisabled={busy} aria-busy={busy} overlayClassName="z-[89]" onOpenAutoFocus={event => { event.preventDefault(); document.getElementById('keep-sale-draft')?.focus(); }}>
          <DialogHeader><DialogTitle>Delete this draft?</DialogTitle><DialogDescription>This permanently removes only this unused or clearly labelled test draft. Invoices, payments, stock and customer enquiry records are kept.</DialogDescription></DialogHeader>
          <p>{record.draft.customer || 'No customer added'}{record.draft.vehicle ? ` — ${record.draft.vehicle}` : ''}</p>
          {problem && <div><p role="alert">{problem}</p><Button variant="outline" disabled={busy} onClick={() => run(async () => {
            const latest = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${record.id}`);
            setDeleteDraftOpen(false); accept({ sale: latest.sale }); setMessage('Latest draft loaded. Review it before deleting.');
          })}>Reload saved sales</Button></div>}
          <DialogFooter><Button id="keep-sale-draft" variant="outline" disabled={busy} onClick={() => { setDeleteDraftOpen(false); setProblem(''); }}>Keep draft</Button><Button variant="destructive" disabled={busy || !canDeleteDraft || dirty || Boolean(problem)} onClick={deleteSavedDraft}>{busy ? 'Deleting…' : 'Delete draft permanently'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>}
      {record && <Dialog open={releaseReservationOpen} onOpenChange={open => { if (!busy) setReleaseReservationOpen(open); }}>
        <DialogContent className="portal-action-dialog sales-action-dialog z-[90]" closeDisabled={busy} aria-busy={busy} overlayClassName="z-[89]" onOpenAutoFocus={event => { event.preventDefault(); keepReservationRef.current?.focus(); }}>
          <DialogHeader><DialogTitle>Release this reservation?</DialogTitle><DialogDescription>The reservation will be removed. The car may become available to customers if it is still in published stock. The sale, invoices and payment history will be kept. No message will be sent.</DialogDescription></DialogHeader>
          {problem && <p role="alert">{problem}</p>}
          <DialogFooter><Button ref={keepReservationRef} variant="outline" disabled={busy} onClick={() => setReleaseReservationOpen(false)}>Keep reserved</Button><Button disabled={busy || dirty || total?.confirmedPaid !== 0 || total?.pending !== 0} onClick={() => run(async () => {
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
  </div>;
}
export default function SalesDemo() { return <SalesWorkspace />; }
