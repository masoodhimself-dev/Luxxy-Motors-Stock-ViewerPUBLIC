import { AddressPostcodeHelper } from '@/components/postcode-field';
import { PartExchangeCheck } from '@/components/portal/part-exchange-check';
import { SaleHandover, SaleHandoverFields, handoverDefaults } from '@/components/portal/sale-handover';
import { SaleTeamAssignment } from '@/components/sales-demo/sale-team-assignment';
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
  saleDocumentEmailRecipientProblem,
  saleWorkspaceTotals,
  saleQueueStatus,
  saleQueueToday,
  saleRefundAttention,
  saleStockConflictRefundDue,
  salePaymentRequestAvailable,
  salePaymentRequestRemaining,
  type SalePaymentRequest,
  saleCalculationFigures,
  saleWorkspaceChecklistProgress,
  latestFullSaleInvoice,
  hasSeparateDeliveryInvoice,
  saleWorkspaceRetainedIntakeChecks,
  type SaleQueueFilter,
  type SaleQueueOwner,
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
import { MarkDepositConfirmationShared } from '@/components/sales-demo/mark-deposit-confirmation-shared';
import { saleInvoiceIsCurrent } from '@/lib/sale-invoice-current';
import { ConfirmSavedPayment } from '@/components/sales-demo/confirm-saved-payment';
import { SalePaymentRequests } from '@/components/sales-demo/sale-payment-requests';
import { SaleDeliveryEvidence } from '@/components/portal/sale-delivery-evidence';
import { SaleTermsDocuments } from '@/components/sale-terms-documents';
import { SaleDeliveryCharge } from '@/components/sales-demo/sale-delivery-charge';
import { SaleDocumentList } from '@/components/sales-demo/sale-document-list';
import { SaleCorrections, type SaleCorrectionIssue } from '@/components/sales-demo/sale-corrections';
import { useSalePaymentDefaults } from '@/components/sales-demo/sale-payment-defaults';
import { DailyPayments } from '@/components/sales-demo/daily-payments';
import { SaleReturnReplace, SaleReplacementRefund } from '@/components/sales-demo/sale-return-replace';
import { SaleReturnCar } from '@/components/sales-demo/sale-return-car';
import { SalesActionMenu, SalesFlowSteps, saleActions, type SaleAction } from '@/components/sales-demo/sales-action-menu';
import { saleActionUnavailable, saleReturnUnavailable } from '@/components/sales-demo/sale-action-availability';
import { saleNextStep } from '@/components/sales-demo/sale-next-step';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { SaleProgress, SaleTimeline } from '@/components/sales-demo/sale-progress';
import { SaleHandoverSummary } from '@/components/sales-demo/sale-handover-summary';
import { SaleStaffHandoff } from '@/components/sales-demo/sale-staff-handoff';
import { SaleCustomerUpdate } from '@/components/sales-demo/sale-customer-update';
import { SalesPracticeWorkspace } from '@/components/sales-demo/sales-practice-workspace';
import { CalculationCheck, useSaleCalculationCheck } from '@/components/sales-demo/calculation-check';
import { InvoiceVehicleReview, type InvoiceVehicleApproval } from '@/components/sales-demo/invoice-vehicle-review';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useStaffAccess } from '@/components/portal/dealer-administration';
import { useIsMobile } from '@/hooks/use-mobile';
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  Search,
  SlidersHorizontal,
  ChevronDown,
} from "@/components/icons";
import "@/sales-workspace.css";
import "./invoice-builder.css";
import "@/sales-workspace-v2.css";
import "@/sales-work-queue.css";
import '@/sales-flow.css';
import '@/sales-overview.css';
import type { SalesWorkspaceTab } from "@/components/sales-demo/workspace-navigation";

export interface SalesWorkspaceProps {
  embedded?: boolean;
  newSaleRequest?: number;
  practiceSaleRequest?: number;
  newSaleVehicleId?: string | null;
  onExit?: () => void;
  quickActions?: ReactNode;
}
type SaleListRow = SaleWorkspaceRecord & { listSummary?: boolean; listOwnerName?: string; listHasTeamNote?: boolean; listAttention?: string; listStage?: string; listHasInvoice?: boolean; listTotalDue?: number; listPaid?: number; listPending?: number; listLedgerKnown?: boolean; listBalance?: number; listRefundDue?: number; listHasCorrectionNotes?: boolean; listHasRefunds?: boolean; listPaymentDue?: string; listHandover?: { method: 'collection' | 'delivery'; status: string; scheduledDate?: string; timeWindow?: string } | null };

type SaleQueueDestination = 'payments' | 'request' | 'handover' | 'invoice' | 'confirmation';
type SaleQueueAction = { label: string; destination: SaleQueueDestination };
type StaffTaskDestination = { taskId: string; screen: 'payments' | 'handover' | 'tasks' };
type SaleOpenDestination = 'next' | SaleQueueDestination | StaffTaskDestination;
const staffTaskIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
/** List summaries deliberately contain totals, not customer payment details. */
function saleListProgress(sale: SaleListRow) {
  const handover = sale.listHandover;
  const balance = sale.listBalance;
  const correctionReview = Boolean(sale.listHasCorrectionNotes || sale.corrections?.length || (sale.completedAt && (sale.listHasRefunds || sale.payments?.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0))));
  const sold = Boolean(sale.completedAt || sale.lifecycle?.status === 'sold');
  const returned = Boolean(sale.standaloneReturn || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned');
  const released = sale.lifecycle?.status === 'released';
  const fulfilled = handover?.status === 'Collected' || handover?.status === 'Delivered';
  const status = sale.listStage || (returned ? 'Returned' : released ? 'Released' : fulfilled ? handover!.status : sold ? 'Sold' : sale.lifecycle?.status === 'reserved' ? 'Reserved' : 'Draft');
  const action = sale.listAttention;
  const reviewHistory = sale.listLedgerKnown === false || (sale.listPending ?? 0) > 0 || (sale.listPaid ?? 0) !== 0;
  let hint: string | undefined, shortcut: SaleQueueAction | undefined;
  if (action === saleRefundAttention) {
    shortcut = { label: 'Review payment for refund', destination: 'payments' };
  } else if (released || returned) {
    hint = correctionReview ? 'Review correction with accountant' : reviewHistory ? 'Review payment history' : released ? 'Sale not completed' : 'Vehicle returned';
    if (correctionReview || reviewHistory) shortcut = { label: 'View payment history', destination: 'payments' };
  } else if (correctionReview) {
    hint = 'Review correction with accountant';
    shortcut = { label: 'Review payments', destination: 'payments' };
  } else if (action === 'Payment to confirm' || (sale.listPending ?? 0) > 0) {
    shortcut = { label: 'Review pending payment', destination: 'payments' };
  } else if (action === 'Deposit confirmation to send') {
    shortcut = { label: 'Send deposit confirmation', destination: 'confirmation' };
  } else if (action === 'Payment request due' || status === 'Deposit requested') {
    shortcut = { label: 'Review payment request', destination: 'request' };
  } else if (action === 'Delivery to rearrange' || action === 'Delivery due' || action === 'Collection due') {
    shortcut = { label: action === 'Delivery to rearrange' ? 'Rearrange delivery' : 'View handover', destination: 'handover' };
  } else if (action === 'Invoice to review' || status === 'Invoice ready') {
    shortcut = { label: 'View invoice', destination: 'invoice' };
  } else if (fulfilled) {
    shortcut = { label: 'View sale documents', destination: 'payments' };
  } else if (!sale.draft.vehicleId || !sale.draft.customer?.trim()) {
    hint = !sale.draft.vehicleId ? 'Add the vehicle' : 'Add customer details';
  } else if (typeof balance !== 'number' || sale.listLedgerKnown === false) {
    hint = 'Open sale to review the balance';
  } else if (balance !== 0) {
    shortcut = { label: balance < 0 ? 'Review customer credit' : 'Review balance', destination: 'payments' };
  } else if (sold) {
    shortcut = { label: handover && handover.status !== 'To arrange' ? 'View handover' : 'Arrange handover', destination: 'handover' };
  }
  return { status, hint, shortcut, handover, balance, correctionReview, released };
}
function saleQueueDate(sale: SaleListRow, destination?: SaleOpenDestination) {
  const handover = destination === 'handover' ? sale.listHandover : undefined;
  const paymentDue = destination === 'request' || destination === 'payments' ? sale.listPaymentDue : undefined;
  const date = handover?.status === 'Booked' ? handover.scheduledDate : paymentDue;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const day = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(day.getTime())) return '';
  const label = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(day);
  return handover ? [label, handover.timeWindow].filter(Boolean).join(' · ') : `Due ${label}`;
}
type SaleListPage = { sales: SaleListRow[]; hasMore?: boolean };
const salesListKey = ['sale-workspace', 'list'] as const;
const queueViews: Array<{ id: SaleQueueFilter; label: string }> = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'all', label: 'All sales' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];
function salesListUrl(q = '', offset = 0, queue: SaleQueueFilter = 'all', owner: SaleQueueOwner = 'all') {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (offset) params.set('offset', String(offset));
  if (queue !== 'all') params.set('queue', queue);
  if (owner !== 'all') params.set('owner', owner);
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
  practiceSaleRequest = 0,
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
  const receiptEmailAvailabilityId = useId();
  const paymentFormId = useId();
  const moneyBreakdownId = useId();
  const compactFooter = useIsMobile(761);
  const [moneyBreakdownOpen, setMoneyBreakdownOpen] = useState(false);
  const moneyBreakdownButton = useRef<HTMLButtonElement>(null);
  const paymentActionButton = useRef<HTMLButtonElement>(null);
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
  const [handoffDraftDirty, setHandoffDraftDirty] = useState(false);
  const [refundDraftDirty, setRefundDraftDirty] = useState(false);
  const [requestDraftDirty, setRequestDraftDirty] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [teamDraftDirty, setTeamDraftDirty] = useState(false);
  const [filter, setFilter] = useState(''), [listSearch, setListSearch] = useState('');
  const [selectedQueueId, setSelectedQueueId] = useState<string>();
  const [queue, setQueue] = useState<SaleQueueFilter>('attention');
  const [ownerFilter, setOwnerFilter] = useState<SaleQueueOwner>('all');
  const pendingNextSale = useRef<{ id: string; destination: SaleOpenDestination } | null>(null);
  const [focusedStaffTask, setFocusedStaffTask] = useState<{ id: string; request: number } | null>(null);
  const staffTaskFocusRequest = useRef(0);
  const [queueFiltersOpen, setQueueFiltersOpen] = useState(false);
  const queueContextId = useId();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openRequest = useRef(0), openController = useRef<AbortController | null>(null);
  useEffect(() => { const timer = setTimeout(() => setListSearch(filter.trim()), 250); return () => clearTimeout(timer); }, [filter]);
  useEffect(() => () => { openRequest.current++; openController.current?.abort(); }, []);
  const sales = useInfiniteQuery({
    queryKey: [...salesListKey, listSearch, queue, ownerFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => customFetch<SaleListPage>(salesListUrl(listSearch, pageParam, queue, ownerFilter), { signal }),
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
  const [quickSale, setQuickSale] = useState(false);
  const [resumeInvoice, setResumeInvoice] = useState<string | null>(null);
  const [resumeAfterPayment, setResumeAfterPayment] = useState<'invoice' | 'handover' | null>(null);
  const [returnChoice, setReturnChoice] = useState<'return' | 'replace' | null>(null);
  const [practice, setPractice] = useState(false);
  const [dailyPaymentsOpen, setDailyPaymentsOpen] = useState(false);
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
  const [vehicleApproval, setVehicleApproval] = useState<InvoiceVehicleApproval | null>(null);
  const [issued, setIssued] = useState<SaleWorkspaceDocument | null>(null);
  const [emailReview, setEmailReview] = useState<SaleWorkspaceDocument | null>(null);
  const emailReviewOpener = useRef<HTMLButtonElement | null>(null);
  const [correction, setCorrection] = useState<{ issue?: SaleCorrectionIssue } | null>(null);
  const paymentDefaults = useSalePaymentDefaults(Boolean(draft && (flowScreen === 'request' || flowScreen === 'deposit')));
  const suggestedDeposit = paymentDefaults.data?.paymentDefaults.suggestedDepositPence;
  const depositPresets = [...new Set([...(suggestedDeposit ? [suggestedDeposit] : []), 10000, 25000, 50000])];
  const [soldChoice, setSoldChoice] = useState(false);
  const [outstandingAccepted, setOutstandingAccepted] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<SaleWorkspacePayment | null>(null);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [duplicateAccepted, setDuplicateAccepted] = useState(false);
  const [depositConfirmOpen, setDepositConfirmOpen] = useState(false);
  const [stockConflictRefund, setStockConflictRefund] = useState<{ reason: string; received: boolean } | null>(null);
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
  const consumedPractice = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const setupError = useRef<HTMLDivElement>(null);
  const returnHelpId = useId();
  const depositInvoiceHelpId = useId();
  const soldAvailabilityId = useId();
  const scrollPane = useRef<HTMLElement>(null);
  const detailsDirty = Boolean(
    draft && JSON.stringify(draft) !== JSON.stringify(record?.draft),
  );
  const currentVehicleApproval = vehicleApproval && vehicleApproval.saleId === record?.id &&
    vehicleApproval.revision === record.revision && !detailsDirty ? vehicleApproval : null;
  const checklistReady = Boolean(record && !detailsDirty && saleWorkspaceChecklistProgress(record).ready);
  const saleDraftDirty = detailsDirty || Boolean(payment.amount.trim()) || returnDraftDirty || refundDraftDirty || requestDraftDirty;
  const dirty = saleDraftDirty || teamDraftDirty || handoffDraftDirty;
  const canDeleteDraft = Boolean(record?.emptyDraftDeletable && access.data?.permissions.includes('sales.manage'));
  const rows = record?.payments ?? [];
  const paymentRequests = record?.paymentRequests ?? [];
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
  const reviewingEnquiry = Boolean(!record && draft?.sourceEnquiryId && vehicle &&
    (!vehicle.inventoryStatus || vehicle.inventoryStatus === 'available'));
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
    setFocusedStaffTask(null);
    setDeleteDraftOpen(false);
    setPendingConfirmation(null); setDuplicateConfirmOpen(false); setDuplicateAccepted(false);
    setDepositConfirmOpen(false); setDepositRequestId(undefined); setConfirmationDocument(null);
    setStockConflictRefund(null);
    setRecord(saved ?? null);
    setDraft(initial ?? (saved ? structuredClone(saved.draft) : emptyDraft()));
    setStep(saved?.draft.vehicleId ? 1 : 0);
    setShowSummary(false);
    setWorkspaceTab("deal");
    setDealSection(saved?.draft.vehicleId ? "customer" : "vehicle");
    const starting = initial ?? saved?.draft;
    const linkedStock = initial?.sourceEnquiryId && stock?.cars.find(car => car.id === initial.vehicleId);
    const reviewEnquiry = Boolean(linkedStock && (!linkedStock.inventoryStatus || linkedStock.inventoryStatus === 'available'));
    setFlowScreen(reviewEnquiry ? 'customer' : starting?.vehicleId ? starting.customer?.trim() ? 'menu' : 'customer' : 'car');
    setQuickSale(false);
    setResumeInvoice(null);
    setResumeAfterPayment(null);
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
    setEmailReview(null);
    setCorrection(null);
    setReviewed(false);
    setSoldChoice(false);
    setOutstandingAccepted(false);
  }
  async function open(saved?: Pick<SaleListRow, 'id'>, initial?: SaleDraft, destination?: SaleOpenDestination, onCancel?: () => void) {
    if (lock.current || busy || (!saved && !canManageSales)) return;
    if (dirty && !window.confirm('Leave your unsaved invoice details?')) {
      openRequest.current++; openController.current?.abort(); setOpeningId(null); onCancel?.(); return;
    }
    pendingNextSale.current = null;
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
      if (destination) pendingNextSale.current = { id: result.sale.id, destination };
      displaySale(result.sale);
    } catch (error) {
      if (!controller.signal.aborted && request === openRequest.current) setProblem((error as { data?: { error?: string } })?.data?.error || 'This sale could not be loaded. Refresh sales and try again.');
    } finally { if (request === openRequest.current) setOpeningId(null); }
  }
  useEffect(() => {
    if (practiceSaleRequest <= consumedPractice.current || busy || openingId || stockLoading || !access.data) return;
    consumedPractice.current = practiceSaleRequest;
    if (!canManageSales || practice) return;
    setDailyPaymentsOpen(false);
    if (stockError || !stock?.cars.length) {
      setProblem(stockError ? 'Stock could not be loaded for practice.' : 'Add a car to stock before starting a practice sale.');
      return;
    }
    setPractice(true);
  }, [practiceSaleRequest, busy, openingId, stockLoading, access.data, canManageSales, practice, stockError, stock]);
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
  const salesSectionActive = !embedded || new URLSearchParams(search).get('section') === 'sales';
  useEffect(() => {
    if (salesSectionActive) return;
    consumed.current = '';
    pendingNextSale.current = null;
    stockDeferredSource.current = '';
    openController.current?.abort();
    setOpeningId(null);
  }, [salesSectionActive]);
  useEffect(() => {
    if (!salesSectionActive) return;
    const params = new URLSearchParams(search);
    const id = params.get('saleId'), enquiryId = params.get('enquiryId'), reservationId = params.get('reservationId');
    const action = params.get('saleAction');
    const taskId = params.get('saleTaskId');
    const taskDestination = id && taskId && staffTaskIdPattern.test(taskId) &&
      (action === 'payments' || action === 'handover' || action === 'tasks')
      ? { taskId, screen: action } satisfies StaffTaskDestination
      : undefined;
    const destination = taskDestination ?? (action === 'next' || action === 'payments' || action === 'request' ||
      action === 'handover' || action === 'invoice' || action === 'confirmation' ? action : undefined);
    const key = [id, enquiryId, reservationId].join(':') + (id && destination ? `:${action}` : '') +
      (taskDestination ? `:${taskDestination.taskId}` : '');
    if (key === '::') { consumed.current = ''; return; }
    if (key === consumed.current || busy || lock.current || (!id && (enquiries.isLoading || !access.data))) return;
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
    if (id) { void open({ id }, undefined, destination, clearLinkedSaleUrl); return; }
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
      if (!canManageSales) {
        setOpeningId(null);
        setProblem('You do not have permission to start a sale from this enquiry.');
        return;
      }
      const source = customerOptions.find(item => enquiryId ? item.sourceEnquiryId === enquiryId : reservationId && item.sourceReservationId === reservationId);
      if (!source) { setOpeningId(null); setProblem('This customer record could not be found. Reopen the original enquiry before starting its sale.'); return; }
      const car = stock?.cars.find(item => item.id === source.vehicleId);
      const linkedEnquiry = enquiryId ? enquiries.data?.find(item => item.id === enquiryId) : undefined;
      const unavailable = Boolean(enquiryId && source.vehicleId && stock && !stockError &&
        (!car || (car.inventoryStatus && car.inventoryStatus !== 'available')));
      void open(undefined, { ...emptyDraft(), customer: source.customerName, email: source.email, phone: source.phone,
        vehicleId: unavailable ? '' : source.vehicleId,
        vehicle: unavailable ? '' : car ? vehicleDisplayTitle(car) : linkedEnquiry?.vehicleTitle || '',
        registration: unavailable ? '' : car ? vehicleRegistration(car) : linkedEnquiry?.vehicleRegistration || '',
        price: !unavailable && car?.price != null ? String(car.price) : '',
        sourceEnquiryId: source.sourceEnquiryId, sourceReservationId: source.sourceReservationId, customerSource: source.key });
      if (unavailable) setProblem('The car from this enquiry is no longer available. Choose an available car to keep going with the customer details.');
      else if (stockError) setProblem('Current stock could not be loaded. The enquiry details are kept. Confirm the car and enter the agreed price before continuing.');
    }).catch(() => { if (!controller.signal.aborted && request === openRequest.current) { setOpeningId(null); setProblem('The linked sale could not be checked. Reopen the enquiry or refresh sales before continuing.'); } });
  }, [search, salesSectionActive, enquiries.data, enquiries.isLoading, stock, stockLoading, stockError, busy, access.data, canManageSales]);
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
  useEffect(() => { setMoneyBreakdownOpen(false); }, [record?.id, flowScreen, paymentFormOpen, compactFooter]);
  function update<K extends keyof SaleDraft>(key: K, value: SaleDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setReviewed(false);
    setProblem("");
  }
  function accept(result: SaleWorkspaceMutation, reloaded = false) {
    setRecord(previous => !reloaded && previous?.stockActionBlock && previous.id === result.sale.id &&
      previous.draft.vehicleId === result.sale.draft.vehicleId && !result.sale.stockActionBlock
      ? { ...result.sale, stockActionBlock: previous.stockActionBlock }
      : result.sale);
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
    onReviewIntake={() => {
      setResumeInvoice(issued?.id ?? null);
      setFlowScreen('extras'); setWorkspaceTab('deal'); setDealSection('extras'); setIssued(null); setShowSummary(false); setStep(0); setProblem('');
    }} /> : null;
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
      }).catch(error => {
        if (!(canRefundPayments && error instanceof HttpApiError && error.status === 409 && error.data && typeof error.data === 'object' && 'code' in error.data && error.data.code === 'sale-vehicle-conflict')) throw error;
        setDepositConfirmOpen(false);
        setDuplicateConfirmOpen(false);
        setStockConflictRefund({ reason: '', received: false });
        return null;
      });
      if (!result) return;
      const received = pence(payment.amount);
      const updated = saleWorkspaceTotals(result.sale.draft, result.sale.payments);
      setPayment({ ...payment, amount: "", reference: "", received: false });
      setDepositConfirmOpen(false); setDuplicateConfirmOpen(false); setDuplicateAccepted(false); setDepositRequestId(undefined); setPaymentFormOpen(false);
      setReviewed(false);
      if (payment.kind === 'deposit') {
        setConfirmationDocument(result.document?.type === 'receipt' ? result.document : null);
        setMessage(`${saleMoney(received)} deposit recorded. Car reserved. ${saleMoney(updated.balance)} left to pay.`);
      } else setMessage(`${saleMoney(received)} payment recorded. ${!sold && record?.lifecycle?.status !== 'reserved' && result.sale.lifecycle?.status === 'reserved' ? 'Car reserved. ' : ''}${saleMoney(updated.balance)} left to pay.`);
      if (quickSale) {
        if (updated.balance === 0 && payment.kind !== 'deposit') chooseAction('invoice');
        else setQuickSale(false);
      }
      else if (resumeAfterPayment && payment.kind !== 'deposit') resumeBlockedAction();
      // Refreshing stock must not turn a successfully recorded payment into a failed save.
      void client.invalidateQueries({ queryKey: getGetStockQueryKey() }).catch(() => {});
    });
  }
  function recordPaymentForRefund() {
    if (!canRecordPayments || !canRefundPayments || !payment.received || !stockConflictRefund?.received || !stockConflictRefund.reason.trim()) return;
    run(async () => {
      await command('/invoice-payments', {
        payment: { amount: payment.amount, method: payment.method, date: payment.date, reference: payment.reference, kind: 'part-payment', status: 'confirmed' },
        stockConflictReconciliation: { reason: stockConflictRefund.reason, acknowledge: true },
      });
      setStockConflictRefund(null);
      setQuickSale(false);
      setPayment({ ...payment, amount: '', reference: '', received: false });
      setDuplicateAccepted(false); setDepositRequestId(undefined); setPaymentFormOpen(false);
      setFlowScreen('history'); setWorkspaceTab('payments');
      setMessage(`${saleMoney(pence(payment.amount))} recorded for refund. The other sale still holds the car.`);
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
    if (!currentVehicleApproval || !reviewed) return;
    run(async () => {
      if (!draft) return;
      const issues = errors({ ...draft, payments: rows }, record?.draft);
      if (issues.length) throw new Error(issues.join(" "));
      const saved = await saveInternal();
      if (saved.id !== currentVehicleApproval.saleId || saved.revision !== currentVehicleApproval.revision) {
        throw new Error('Check the vehicle again before creating this invoice.');
      }
      await calculation.check(saved, draft as SaleWorkspaceDraft);
      const result = await request(`/api/sale-workspace/${saved.id}/issue-invoice`, 'POST', {
        expectedRevision: saved.revision, kind, acknowledge: reviewed,
        vehicleReview: {
          id: currentVehicleApproval.id, mileage: currentVehicleApproval.mileage, acknowledge: true,
          ...(currentVehicleApproval.acknowledgeMot ? { acknowledgeMot: true } : {}),
        },
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
  function documentEmailProblem(doc: SaleWorkspaceDocument) {
    if (!canEmailCustomer) return emailUnavailableReason;
    if (!canRecordPayments) return 'Ask a member of staff with payment access to email this document.';
    if (!record?.documents.some(item => item.id === doc.id)) return 'Open the saved sale before emailing this document.';
    if (detailsDirty) return 'Save your changes to the sale before emailing this document.';
    return saleDocumentEmailRecipientProblem(record.draft, doc.snapshot.draft);
  }
  const issuedEmailProblem = issued ? documentEmailProblem(issued) : undefined;
  const issuedRecipientChanged = Boolean(record && issued && saleDocumentEmailRecipientProblem(record.draft, issued.snapshot.draft));
  const receiptEmailProblem = confirmationDocument ? documentEmailProblem(confirmationDocument) : undefined;
  const receiptRecipientChanged = Boolean(record && confirmationDocument &&
    saleDocumentEmailRecipientProblem(record.draft, confirmationDocument.snapshot.draft));
  const receiptEmailSent = record?.emailDeliveries?.some(row => row.documentId === confirmationDocument?.id && row.status === 'sent');
  const reviewedEmailProblem = emailReview ? documentEmailProblem(emailReview) : undefined;
  function reviewDocumentEmail(doc: SaleWorkspaceDocument, opener: HTMLButtonElement) {
    if (busy || documentEmailProblem(doc)) return;
    emailReviewOpener.current = opener;
    setProblem("");
    setEmailReview(doc);
  }
  function restoreEmailReviewFocus(event: Event) {
    const opener = emailReviewOpener.current;
    emailReviewOpener.current = null;
    if (!opener?.isConnected || opener.disabled) return;
    event.preventDefault();
    opener.focus({ preventScroll: true });
  }
  function email(doc: SaleWorkspaceDocument) {
    if (!record || documentEmailProblem(doc)) return;
    run(async () => {
      const result = await request(`/api/sale-workspace/${record.id}/documents/${doc.id}/email`, 'POST', { expectedRevision: record.revision });
      accept(result);
      setEmailReview(null);
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
    setMessage(canEmailCustomer ? "Choose Email customer to review the recipient and send the saved PDF." : `Review this saved document. ${emailUnavailableReason}`);
  }
  function clearLinkedSaleUrl() {
    const params = new URLSearchParams(search);
    const linkedKeys = ['saleId', 'saleAction', 'saleTaskId', 'enquiryId', 'reservationId'];
    if (!linkedKeys.some(key => params.has(key))) return;
    for (const key of linkedKeys) params.delete(key);
    params.set('section', 'sales');
    navigate(`/portal?${params}`, { replace: true });
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
    setEmailReview(null);
    setProblem("");
    if (embedded) clearLinkedSaleUrl();
    else navigate("/portal?section=sales");
  }
  const nextStep = record ? saleNextStep(record) : null;
  const latestInvoice = (record && latestFullSaleInvoice(record.documents)) ?? null;
  const needsCorrectionReview = !record?.standaloneReturn && Boolean(record?.corrections?.length || (record?.completedAt && rows.some(row => row.status === 'confirmed' && row.signedAmountPence < 0)));
  const separateDeliveryInvoice = Boolean(record && hasSeparateDeliveryInvoice(record));
  const stockRefundDue = record ? saleStockConflictRefundDue(record) : 0;
  const displayedBalance = stockRefundDue || Math.abs(total?.balance ?? 0);
  const balanceLabel = stockRefundDue > 0 ? 'To refund' : needsCorrectionReview ? 'Balance to review' :
    record?.lifecycle?.status === 'released' ? 'Closed sale balance' :
    total && total.balance < 0 ? 'To return' : 'Left to pay';

  const invoiceIsCurrent = Boolean(latestInvoice && draft && saleInvoiceIsCurrent(latestInvoice, draft as SaleWorkspaceDraft, rows, record?.documents));
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
    if (payment.amount.trim() || !latestInvoice || !invoiceIsCurrent || latestInvoice.invoiceKind === "deposit") {
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
    : latestInvoice && invoiceIsCurrent && !record?.completedAt
      ? { label: "Review sale completion", note: "The full invoice is saved. Review it and choose whether to mark the car sold.", run: reviewSavedInvoice }
    : total.balance > 0
      ? { label: "Record a payment", note: "Continue with the next payment, or prepare the invoice when you need it.", run: () => resumeAt(2) }
    : { label: latestInvoice ? "Create updated invoice" : "Create invoice", note: latestInvoice ? "The details or payments have changed since the saved invoice." : "The balance is settled. Prepare the customer’s invoice.", run: () => resumeAt(3) };
  const matchingSales = listRows;
  const selectedQueueSale = matchingSales.find(sale => sale.id === selectedQueueId) ?? matchingSales[0];
  const selectedProgress = selectedQueueSale && saleListProgress(selectedQueueSale);
  const canOpenQueueAction = (action?: SaleQueueAction) => action &&
    (!['request', 'confirmation'].includes(action.destination) || canRecordPayments) &&
    (action.destination !== 'handover' || canHandover);
  const selectedAction = selectedProgress?.shortcut;
  const selectedDate = selectedQueueSale && saleQueueDate(selectedQueueSale, selectedAction?.destination);
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
  const sold = Boolean(record?.completedAt || record?.lifecycle?.status === 'sold');
  const returned = record?.lifecycle?.status === 'returned' || record?.returnReplacement?.direction === 'returned' || Boolean(record?.standaloneReturn);
  const issuedFullInvoice = issued?.type === 'invoice' && issued.invoiceKind !== 'deposit';
  const issuedInvoiceIsCurrent = issuedFullInvoice && issued.id === latestInvoice?.id && invoiceIsCurrent;
  const canUpdateStaleInvoice = canRecordPayments && !sold && !returned && !released && !separateDeliveryInvoice;
  const canCorrect = Boolean(record && !released && (canManageSales || canRefundPayments));
  const canReviewUpdatedInvoice = Boolean(canCorrect && canRecordPayments && issued?.type === 'invoice' &&
    !sold && !returned && !separateDeliveryInvoice && record &&
    !saleDocumentEmailRecipientProblem(record.draft, record.draft));
  const unavailable = saleActionUnavailable(record, accountingDraft, total, {
    manage: canManageSales, record: canRecordPayments, handover: canHandover, refund: canRefundPayments,
  }, stockRefundDue);
  const plainReturnBlock = record && total ? saleReturnUnavailable(record, total) : undefined;
  const replacementBlock = plainReturnBlock || (total && (total.balance !== 0 || total.confirmedPaid <= 0)
    ? 'Settle the original sale before transferring its credit.' : undefined);
  const depositInvoiceBlock = sold ? 'This car is already sold.'
    : rows.some(row => row.kind === 'deposit' && row.status === 'confirmed') && total && total.confirmedPaid > 0
      ? undefined : 'Record a received deposit first.';
  const soldBlock = record?.stockActionBlock || stockRefundDue > 0 ? unavailable.invoice : undefined;
  const canChangeAction = () => !busy && (!(returnDraftDirty || refundDraftDirty || requestDraftDirty || teamDraftDirty || handoffDraftDirty) || window.confirm('Leave this unfinished action? Its unsaved details will be lost.'));
  const showMenu = () => { setFocusedStaffTask(null); setQuickSale(false); setResumeInvoice(null); setResumeAfterPayment(null); setConfirmationDocument(null); setFlowScreen('menu'); setWorkspaceTab('deal'); setIssued(null); setProblem(''); };
  const goToMenu = () => { if (canChangeAction()) showMenu(); };
  const handoverCompleted = Boolean(record?.draft.fulfilment?.completedAt);
  function chooseAction(action: SaleAction) {
    if (!draft || unavailable[action] || !canChangeAction()) return;
    setFocusedStaffTask(null);
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
  const canStartQuickSale = Boolean(record && draft && total && !busy && !dirty && canManageSales &&
    !sold && !released && !returned && !unavailable.payment && !unavailable.invoice && !unavailable.handover &&
    total.balance > 0 && Number.isSafeInteger(total.balance) && !rows.length && !record.documents.some(document => document.type === 'invoice') &&
    !draft.partExchange && !draft.exchanges?.length && !deliveryAmount && !transferredCredit && draft.fulfilment?.method !== 'delivery' &&
    !paymentRequests.some(request => salePaymentRequestAvailable(record, request, new Date().toISOString()) && salePaymentRequestRemaining(record, request) > 0));
  function startQuickSale() {
    if (!canStartQuickSale || !total) return;
    chooseAction('payment');
    setPayment(current => ({ ...current, kind: 'final-payment', amount: (total.balance / 100).toFixed(2), received: false }));
    setQuickSale(true);
  }
  function openUnfinishedPayment(from: 'invoice' | 'handover') {
    const action = payment.kind === 'deposit' ? 'deposit' : 'payment';
    if (unavailable[action]) { setProblem(unavailable[action] ?? ''); return; }
    if (!canChangeAction()) return;
    chooseAction(action);
    setResumeAfterPayment(from);
  }
  function resumeBlockedAction() {
    if (!resumeAfterPayment || unavailable[resumeAfterPayment]) return;
    chooseAction(resumeAfterPayment);
    if (resumeAfterPayment === 'invoice') setKind(kind);
    setResumeAfterPayment(null);
  }
  function recordRequestedDeposit(request: SalePaymentRequest) {
    const action = request.kind === 'deposit' ? 'deposit' : 'payment';
    if (!record || unavailable[action] || !canChangeAction()) return;
    if (payment.amount.trim()) { chooseAction(payment.kind === 'deposit' ? 'deposit' : 'payment'); setProblem('Finish or clear this payment before starting another.'); return; }
    chooseAction(action); setDepositRequestId(request.id);
    setPayment(current => ({ ...current, kind: request.kind === 'deposit' ? 'deposit' : 'part-payment', amount: (Math.min(salePaymentRequestRemaining(record, request), total!.balance) / 100).toFixed(2), reference: request.reference, received: false }));
  }
  function displayDocument(document: SaleWorkspaceDocument) {
    setFlowScreen('invoice'); setWorkspaceTab('invoices'); setIssued(document);
    setSoldChoice(false); setOutstandingAccepted(false); setProblem('');
  }
  function openDocument(document: SaleWorkspaceDocument) {
    if (canChangeAction()) displayDocument(document);
  }
  const resumeInvoiceDocument = record?.documents.find(document => document.id === resumeInvoice);
  const returnToInvoice = resumeInvoiceDocument && <Button variant="outline" disabled={busy} onClick={() => {
    if (!canChangeAction()) return;
    setResumeInvoice(null);
    displayDocument(resumeInvoiceDocument);
  }}>Back to invoice</Button>;
  function openCorrection(issue?: SaleCorrectionIssue) {
    if (canCorrect && !busy && !dirty) setCorrection({ issue });
  }
  function openPaymentHistory() {
    if (!canChangeAction()) return;
    setFocusedStaffTask(null);
    setFlowScreen('history'); setWorkspaceTab('payments'); setPaymentFormOpen(false);
    setIssued(null); setProblem('');
  }
  function followNextStep() {
    if (!nextStep || !record || !nextStepAllowed) return;
    if (nextStep.action === 'mark-sold') {
      const document = record.documents.find(doc => doc.id === nextStep.documentId);
      if (!document || !canManageSales || !canChangeAction()) return;
      setFlowScreen('invoice'); setWorkspaceTab('invoices'); setIssued(document);
      setSoldChoice(false); setOutstandingAccepted(false); setProblem('');
      return;
    }
    if (nextStep.action === 'confirmation') {
      setConfirmationDocument(record.documents.find(doc => doc.id === nextStep.documentId) ?? null);
      setFlowScreen('deposit'); setPaymentFormOpen(false); return;
    }
    if ((nextStep.action === 'deposit' || nextStep.action === 'payment') && nextStep.requestId) {
      const request = record.paymentRequests?.find(row => row.id === nextStep.requestId);
      if (request) recordRequestedDeposit(request); return;
    }
    if (nextStep.action === 'history') { openPaymentHistory(); return; }
    chooseAction(nextStep.action);
  }
  const nextStepBlock = nextStep?.action === 'mark-sold' ? soldBlock
    : nextStep && nextStep.action !== 'history' && nextStep.action !== 'confirmation' ? unavailable[nextStep.action] : undefined;
  const nextStepAllowed = Boolean(nextStep && !nextStepBlock &&
    (!['deposit', 'payment', 'request', 'invoice', 'confirmation', 'mark-sold'].includes(nextStep.action) || canRecordPayments) &&
    (nextStep.action !== 'handover' || canHandover) &&
    (!['deposit', 'mark-sold'].includes(nextStep.action) || canManageSales));
  useEffect(() => {
    const intent = pendingNextSale.current;
    if (!record || intent?.id !== record.id || openingId || busy || !access.data) return;
    pendingNextSale.current = null;
    const { attention, closed } = saleQueueStatus(record, saleQueueToday());
    if (typeof intent.destination === 'object') {
      const { taskId, screen } = intent.destination;
      const focusTask = () => setFocusedStaffTask({ id: taskId, request: ++staffTaskFocusRequest.current });
      const task = record.handoffTasks?.find(item => item.id === taskId);
      if (task?.status === 'open' && task.assigneeId === access.data.user?.authUserId) {
        if (screen === 'payments' && task.kind === 'check-payment' && canRecordPayments) {
          openPaymentHistory();
          focusTask();
          return;
        }
        if (screen === 'handover' && task.kind === 'arrange-collection' && !closed && !unavailable.handover) {
          chooseAction('handover');
          focusTask();
          return;
        }
      }
      setFlowScreen('menu');
      setWorkspaceTab('deal');
      focusTask();
      return;
    }
    if (intent.destination !== 'next') {
      if (intent.destination === 'payments') openPaymentHistory();
      else if (intent.destination === 'confirmation' && nextStepAllowed && nextStep?.action === 'confirmation') followNextStep();
      else if (intent.destination === 'handover' && canHandover && !closed) chooseAction('handover');
      else if (intent.destination === 'request' && canRecordPayments && !closed) {
        const now = new Date().toISOString();
        if (record.paymentRequests?.some(request => salePaymentRequestAvailable(record, request, now) && salePaymentRequestRemaining(record, request) > 0)) chooseAction('request');
        else openPaymentHistory();
      }
      else if (intent.destination === 'invoice') {
        const invoice = latestInvoice ?? [...record.documents].reverse().find(document => document.type === 'invoice');
        if (invoice) displayDocument(invoice);
      }
      return;
    }
    if (attention === 'Payment to confirm' || attention === 'Payment history to review' || attention === saleRefundAttention) openPaymentHistory();
    else if (attention === 'Payment request due' && canRecordPayments && !nextStep?.requestId) chooseAction('request');
    else if (['Delivery to rearrange', 'Delivery due', 'Collection due'].includes(attention) && canHandover) chooseAction('handover');
    else if (attention === 'Invoice to review' && latestInvoice && canRecordPayments && canManageSales) displayDocument(latestInvoice);
    else if (nextStepAllowed && record.draft.vehicleId && record.draft.customer.trim()) followNextStep();
  }, [record, openingId, busy, access.data, nextStepAllowed]);
  const editSetup = (selected: 'car' | 'customer' | 'extras') => { if (!canChangeAction()) return; setQuickSale(false); setResumeInvoice(null); setResumeAfterPayment(null); setFlowScreen(selected); setWorkspaceTab('deal'); setDealSection(selected === 'car' ? 'vehicle' : selected); setStep(selected === 'customer' ? 1 : 0); };
  const continueSetup = () => {
    if (!draft) return;
    const issues = errors({ ...draft, customer: flowScreen === 'car' ? 'Customer' : draft.customer, payments: rows }, record?.draft);
    if (issues.length) {
      setProblem(issues.join(' '));
      requestAnimationFrame(() => {
        setupError.current?.focus({ preventScroll: true });
        setupError.current?.scrollIntoView?.({ block: 'nearest' });
      });
      return;
    }
    if (flowScreen === 'car') editSetup('customer');
    else run(async () => { await saveInternal(); showMenu(); });
  };
  const choosingCarOrCustomer = flowScreen === 'car' || flowScreen === 'customer';
  const showBreakdown = total && !choosingCarOrCustomer;
  const mobileBalanceLabel = stockRefundDue === 0 && total?.balance === 0 && total.totalDue > 0 && !needsCorrectionReview && !released && !returned
    ? 'Balance settled' : balanceLabel;
  const isOverview = flowScreen === 'menu';
  const customerUpdate = record && <SaleCustomerUpdate key={record.id} sale={record} canEmail={canManageSales && canEmailCustomer} disabled={busy || dirty} />;
  const depositConfirmation = ['deposit', 'payment', 'menu'].includes(flowScreen) ? confirmationDocument : null;
  const showSummaryAtTop = showBreakdown && (isOverview || Boolean(depositConfirmation));
  const showNextStep = nextStep && !depositConfirmation && (isOverview || (['deposit', 'payment'].includes(flowScreen) && !paymentFormOpen));
  const requestIsNextStep = showNextStep && nextStep.action === 'request' && nextStep.label === 'Request a deposit';
  const screenHeadings: Partial<Record<typeof flowScreen, string>> = {
    car: 'Choose a car',
    customer: reviewingEnquiry ? 'Review sale details' : 'Choose the customer',
    menu: 'Sale overview',
    extras: 'Extras and part exchange',
    history: 'Payments and documents',
  };
  const actionHeading = flowScreen === 'handover' && handoverCompleted
    ? 'View handover'
    : flowScreen === 'request' && sold ? 'Request a payment' : saleActions.find(action => action.id === flowScreen)?.title;
  const screenHeading = depositConfirmation ? 'Deposit recorded' : screenHeadings[flowScreen] ?? actionHeading;
  const nextStepDocument = showNextStep && nextStep.documentId
    ? record?.documents.find(document => document.id === nextStep.documentId)
    : undefined;
  const nextStepAction = showNextStep && <Button className="sale-overview-primary" disabled={busy || !nextStepAllowed} onClick={followNextStep}>{nextStep.label}<ArrowRight size={18} aria-hidden="true" /></Button>;
  const setupAction = workspaceTab === 'deal' && (choosingCarOrCustomer || flowScreen === 'extras') && <Button onClick={continueSetup} disabled={busy}>{flowScreen === 'car' ? 'Choose customer' : reviewingEnquiry && flowScreen === 'customer' ? 'Confirm details and open sale' : 'Choose what to do'}<ArrowRight size={16} aria-hidden="true" /></Button>;
  const paymentAmount = pence(payment.amount);
  const savePaymentAction = total && total.balance > 0 && paymentFormOpen && ['deposit', 'payment', 'history'].includes(flowScreen) && (
    <Button ref={paymentActionButton} type="submit" form={paymentFormId} disabled={busy || Boolean(unavailable[payment.kind === 'deposit' ? 'deposit' : 'payment']) || !payment.received || !(paymentAmount > 0) || paymentAmount > total.balance || !payment.date}>
      {busy ? 'Saving…' : `Save ${paymentAmount > 0 ? `${saleMoney(paymentAmount)} ` : ''}${flowScreen === 'deposit' ? 'deposit' : 'payment'}`}
    </Button>
  );
  const createInvoiceAction = flowScreen === 'invoice' && !issued && canRecordPayments && !released && !returned && (
    <Button disabled={busy || Boolean(unavailable.invoice) || (kind === 'deposit' && Boolean(depositInvoiceBlock)) || !reviewed || !currentVehicleApproval || Boolean(payment.amount.trim())} onClick={generate}><Invoice size={17} aria-hidden="true" />{busy ? 'Creating invoice…' : 'Create & save invoice'}</Button>
  );
  const confirmationAction = depositConfirmation && (
    <Button className="sale-overview-primary" disabled={busy || Boolean(receiptEmailProblem) || receiptEmailSent} aria-describedby={receiptEmailProblem ? receiptEmailAvailabilityId : undefined}
      onClick={event => reviewDocumentEmail(depositConfirmation, event.currentTarget)}><Mail size={18} aria-hidden="true" />{receiptEmailSent ? 'Confirmation sent' : 'Send deposit confirmation'}</Button>
  );
  const moveConfirmationAction = compactFooter && confirmationAction && !receiptEmailProblem && !receiptEmailSent;
  const mobileAction = compactFooter && ((moveConfirmationAction && confirmationAction) || savePaymentAction || createInvoiceAction || setupAction || nextStepAction);
  function restoreMobilePaymentFocus(event: Event) {
    if (!compactFooter) return;
    event.preventDefault();
    const submit = paymentActionButton.current;
    (submit && !submit.disabled ? submit : heading.current)?.focus({ preventScroll: true });
  }
  const backAction = <Button variant="ghost" disabled={busy} onClick={flowScreen === 'menu' ? () => editSetup('customer') : flowScreen === 'car' ? leave : flowScreen === 'customer' ? () => editSetup('car') : goToMenu}><ArrowLeft size={16} aria-hidden="true" />{flowScreen === 'menu' ? 'Back to customer' : flowScreen === 'car' ? 'Back to sales' : flowScreen === 'customer' ? 'Back to car' : 'All actions'}</Button>;
  const moneyBreakdown = showBreakdown && <>
    <dl aria-label={!compactFooter && showSummaryAtTop ? 'Sale amounts' : undefined}>
      <div><dt>Car price</dt><dd>{saleMoney(total.price)}</dd></div>
      {deliveryAmount !== 0 && <div><dt>Delivery</dt><dd>{saleMoney(deliveryAmount)}</dd></div>}
      {otherAdjustments !== 0 && <div><dt>Extras and discounts</dt><dd>{saleMoney(otherAdjustments)}</dd></div>}
      {total.allowance !== 0 && <div><dt>Part exchange</dt><dd>−{saleMoney(total.allowance)}</dd></div>}
      {returnedCredit !== 0 && <div><dt>Return credit</dt><dd>−{saleMoney(returnedCredit)}</dd></div>}
      <div className="sales-flow-breakdown-total"><dt>Agreed total</dt><dd>{saleMoney(total.totalDue)}</dd></div>
      <div data-tone="paid"><dt>Payments received</dt><dd>{saleMoney(actualPaymentsReceived)}</dd></div>
      {transferredCredit !== 0 && <div><dt>Transferred credit</dt><dd>{saleMoney(transferredCredit)}</dd></div>}
      {total.pending > 0 && <div><dt>Still to confirm</dt><dd>{saleMoney(total.pending)}</dd></div>}
      <div className="sales-flow-breakdown-balance" data-tone={displayedBalance === 0 ? 'paid' : 'due'}><dt>{balanceLabel}</dt><dd>{saleMoney(displayedBalance)}</dd></div>
    </dl>
    {total.pending > 0 && <p>Unconfirmed payments are not included in money received.</p>}
    <CalculationCheck result={calculation.result} busy={calculation.busy} error={calculation.error}/>
  </>;
  if (practice) return <SalesPracticeWorkspace cars={stock?.cars ?? []} dealer={settings} onExit={() => setPractice(false)} quickActions={quickActions} />;
  return <div className={`invoice-builder sale-desk sales-flow${draft ? ' is-editing' : ''}`} data-sale-section={workspaceTab} data-flow-screen={flowScreen}>
    <header className="invoice-builder-header sale-desk-header">
      <div className="sale-desk-header-identity">
        <Button type="button" variant="ghost" aria-label={draft ? 'Back to sales' : 'Back to workspace'} disabled={busy} onClick={draft ? leave : () => onExit ? onExit() : navigate('/portal')}><ArrowLeft size={17} /><span>{draft ? 'Sales' : 'Workspace'}</span></Button>
        {(isMultiChoiceWebsite() || settings.identity.logoAsset) ? <img className="sales-flow-logo" src={isMultiChoiceWebsite() ? '/brand/multi-choice-motors/multi-choice-wordmark.svg' : settings.identity.logoAsset} alt={settings.identity.name} /> : <strong>{settings.identity.name}</strong>}
        {draft && <span className="sale-desk-save-status" role="status">{busy ? 'Working…' : detailsDirty ? 'Unsaved changes' : handoffDraftDirty ? 'Unsaved staff task' : teamDraftDirty ? 'Unsaved staff details' : returnDraftDirty ? 'Return not confirmed' : refundDraftDirty ? 'Refund not recorded' : record ? 'Saved' : 'Not saved yet'}</span>}
      </div>
      <div className="sale-desk-header-actions">
        {draft && canManageSales && <Button variant={detailsDirty ? 'default' : 'outline'} disabled={busy || (!detailsDirty && Boolean(record))} onClick={save}>{busy ? 'Saving…' : 'Save details'}</Button>}
        {(!embedded || draft) && quickActions}
        {!embedded && !quickActions && canManageSales && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline">Quick actions</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={busy || stockLoading || Boolean(stockError) || !stock?.cars.length} onSelect={() => setPractice(true)}>
                Try with a real car
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
    {!draft ? <main className={`invoice-builder-list sale-desk-list${dailyPaymentsOpen && canRecordPayments ? '' : ' sale-queue-workspace'}`}>
      {dailyPaymentsOpen && canRecordPayments ? <DailyPayments
        onBack={() => setDailyPaymentsOpen(false)}
        onOpenSale={id => { setDailyPaymentsOpen(false); void open({ id }); }}
      /> : <>
          <header className="sale-queue-heading">
            <h1>Sales</h1>
            {(canManageSales || canRecordPayments) && <div className="sale-queue-heading-actions">
              {canRecordPayments && <Button size="sm" variant="outline" disabled={Boolean(openingId)} onClick={() => setDailyPaymentsOpen(true)}>Daily payments</Button>}
              {canManageSales && <Button size="sm" onClick={() => open()}><Plus size={16} aria-hidden="true" /> New sale</Button>}
            </div>}
          </header>
          <div className="sale-queue-toolbar">
            <div className="sale-queue-search">
              <Search size={17} aria-hidden="true" />
              <Input type="search" aria-label="Search sales" placeholder="Search sales" value={filter} onChange={event => setFilter(event.target.value)} />
            </div>
            <Button type="button" className="sale-queue-filter-toggle" variant="outline" aria-expanded={queueFiltersOpen} aria-controls={`${queueContextId}-filters`} onClick={() => setQueueFiltersOpen(value => !value)}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Filters{ownerFilter !== 'all' && ' (1)'} <ChevronDown size={13} aria-hidden="true" />
            </Button>
            <div role="group" aria-label="Sales view" className="sale-queue-filters">
              {queueViews.map(view => <button type="button" key={view.id} aria-pressed={queue === view.id} onClick={() => setQueue(view.id)}>{view.label}</button>)}
            </div>
            <label id={`${queueContextId}-filters`} className="sale-queue-owner-filter" data-expanded={queueFiltersOpen}>
              <span className="sr-only">Sale owner</span>
              <NativeSelect value={ownerFilter} onChange={event => setOwnerFilter(event.target.value as SaleQueueOwner)}>
                <option value="all">All staff</option>
                <option value="mine">My sales</option>
                <option value="unassigned">Unassigned</option>
              </NativeSelect>
            </label>
          </div>
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
          {matchingSales.length > 0 && <div className="sale-queue-split"><section className="sale-queue-results" aria-label="Sales results">
            <div className="sale-queue-results-count" role="status">
              {matchingSales.length} {matchingSales.length === 1 ? 'sale' : 'sales'}{sales.hasNextPage ? ' shown' : ''}
            </div>
            <div className="sale-queue-column-headings" aria-hidden="true">
              <span>Car and customer</span>
              <span>Progress</span>
              <span>Balance</span>
              <span>Next step</span>
            </div>
            <div className="sale-queue-list">
              {matchingSales.map(sale => {
                const progress = saleListProgress(sale);
                const shortcut = progress.shortcut;
                const showShortcut = shortcut && canOpenQueueAction(shortcut);
                const due = saleQueueDate(sale, showShortcut ? shortcut.destination : undefined);
                const refund = sale.listAttention === saleRefundAttention;
                const balance = !refund && sale.listLedgerKnown !== false ? progress.balance : undefined;
                const price = saleMoney(typeof sale.listTotalDue === 'number' ? sale.listTotalDue : saleWorkspaceTotals(sale.draft, sale.payments).totalDue);
                const amountLabel = progress.correctionReview ? 'Calculated balance (review)' : (balance ?? 0) < 0 ? 'Customer credit' : 'Balance due';
                const balanceText = typeof balance === 'number' ? saleMoney(progress.correctionReview ? balance : Math.abs(balance)) : '';
                const paymentAlert = sale.listAttention || (progress.correctionReview ? 'Correction to review' : '');
                return <article key={sale.id} className="sale-queue-row" data-attention={Boolean(paymentAlert)} data-selected={selectedQueueSale?.id === sale.id}>
                  <button type="button" className="sale-queue-summary" aria-busy={openingId === sale.id} onClick={() => window.matchMedia?.("(min-width: 1280px)")?.matches ? setSelectedQueueId(sale.id) : void open(sale)}>
                    <span className="sale-queue-identity">
                      <strong className="sale-queue-vehicle">{sale.draft.vehicle || 'Vehicle to add'}</strong>
                      <span className="sale-queue-customer">
                        <span id={`${queueContextId}-${sale.id}`}>{sale.draft.customer || 'Customer to add'}</span>
                        {sale.draft.registration && <UKNumberPlate className="sale-queue-plate" value={sale.draft.registration} size="sm" variant="front" />}
                      </span>
                      <small className="sale-queue-owner"><UserRound size={13} aria-hidden="true" /> {sale.listOwnerName || 'Unassigned'}{sale.listHasTeamNote ? ' · Staff note' : ''}</small>
                    </span>
                    <span className="sale-queue-status">
                      <strong className="sale-queue-stage" data-stage={progress.status}>{progress.status}</strong>
                      {sale.listAttention && <small className="sale-queue-attention">{sale.listAttention}</small>}
                      {progress.hint && <small>{progress.hint}</small>}
                      {!progress.released && progress.handover && progress.handover.status !== progress.status && <small>{progress.handover.method === 'delivery' ? 'Delivery' : 'Collection'}: {progress.handover.status}</small>}
                    </span>
                    <span className="sale-queue-amount" data-outstanding={refund || !progress.released && typeof balance === 'number' && (balance !== 0 || progress.correctionReview)}>
                      {refund ? (sale.listRefundDue ? <span className="sale-queue-balance"><small>To refund </small><strong>{saleMoney(sale.listRefundDue)}</strong></span> : null) : progress.released ? <>
                        {typeof sale.listPaid === 'number' && sale.listPaid !== 0 && <strong>{sale.listPaid < 0 ? 'Net paid out' : 'Net received'}: {saleMoney(Math.abs(sale.listPaid))}</strong>}
                        {typeof sale.listPending === 'number' && sale.listPending > 0 && <small>Pending: {saleMoney(sale.listPending)}</small>}
                      </> : typeof balance === 'number' ? balance === 0 && !progress.correctionReview && (sale.listTotalDue ?? 0) > 0
                        ? <strong className="sale-queue-paid">Paid in full</strong>
                        : <span className="sale-queue-balance"><small>{amountLabel}: </small><strong>{balanceText}</strong></span>
                      : null}
                      {!refund && <small>Sale total {price}</small>}
                    </span>
                    {!showShortcut && <span className="sale-queue-open">Open sale <ArrowRight size={14} aria-hidden="true" /></span>}
                  </button>
                  {showShortcut && <Button type="button" size="sm" variant="outline" className="sale-queue-next" disabled={Boolean(openingId)} aria-describedby={`${queueContextId}-${sale.id}`} onClick={() => void open(sale, undefined, shortcut.destination)}><span>{shortcut.label}{due && <small className="sale-queue-date">{due}</small>}</span><ArrowRight size={15} aria-hidden="true" /></Button>}
                </article>;
              })}
            </div>
          </section>
          {selectedQueueSale && selectedProgress && <aside className="sale-queue-preview" aria-label="Selected sale">
            <header><small>{selectedQueueSale.reference}</small><h2>{selectedQueueSale.draft.vehicle || 'Vehicle to add'}</h2>
              {selectedQueueSale.draft.registration && <UKNumberPlate value={selectedQueueSale.draft.registration} size="sm" />}
            </header>
            <div className="sale-queue-preview-body">
              <strong>{selectedQueueSale.draft.customer || 'Customer to add'}</strong>
              <p>{selectedProgress.status}{selectedDate && <small>{selectedDate}</small>}</p>
              <dl>
                {typeof selectedQueueSale.listTotalDue === 'number' && <><dt>Sale total</dt><dd>{saleMoney(selectedQueueSale.listTotalDue)}</dd></>}
                {selectedQueueSale.listLedgerKnown !== false && typeof selectedQueueSale.listPaid === 'number' && <><dt>Paid</dt><dd>{saleMoney(selectedQueueSale.listPaid)}</dd></>}
                {selectedQueueSale.listLedgerKnown !== false && !selectedProgress.released && typeof selectedProgress.balance === 'number' && <><dt>{selectedProgress.correctionReview ? 'Calculated balance (review)' : selectedProgress.balance < 0 ? 'Customer credit' : 'Balance due'}</dt><dd>{saleMoney(selectedProgress.correctionReview ? selectedProgress.balance : Math.abs(selectedProgress.balance))}</dd></>}
              </dl>
              {selectedAction && canOpenQueueAction(selectedAction) && <Button aria-label={`${selectedAction.label} for selected sale`} disabled={Boolean(openingId)} onClick={() => void open(selectedQueueSale, undefined, selectedAction.destination)}>{selectedAction.label}</Button>}
              <Button variant="outline" disabled={Boolean(openingId)} onClick={() => void open(selectedQueueSale)}>Open sale</Button>
            </div>
          </aside>}
          </div>}
          {sales.hasNextPage && <Button className="sale-queue-load" variant="outline" disabled={sales.isFetchingNextPage || sales.isFetching} onClick={() => void sales.fetchNextPage()}>{sales.isFetchingNextPage ? 'Loading more sales…' : 'Load more sales'}</Button>}
          {!sales.isLoading && !sales.isError && (Boolean(listSearch) || queue !== 'all' || ownerFilter !== 'all') && !matchingSales.length && (
            <div className="invoice-empty" role="status">
              <h2>{queue === 'attention' && !listSearch && ownerFilter === 'all' ? 'Nothing needs attention' : 'No matching sales'}</h2>
              <p>{listSearch ? 'Try another customer, car or registration.' : 'Choose All sales to see your other deals.'}</p>
            </div>
          )}
          {!sales.isLoading && !sales.isError && !listSearch && queue === 'all' && ownerFilter === 'all' && !matchingSales.length && (
            <div className="invoice-empty">
              <Invoice size={32} />
              <h2>Start your first sale</h2>
              <p>
                Choose a customer and car, record the payments, then create the
                paperwork.
              </p>
            </div>
          )}</>}
      </main> : <>
      <SalesFlowSteps step={flowScreen === 'car' ? 0 : flowScreen === 'customer' ? 1 : 2} disabled={busy}
        onChoose={selected => selected === 0 ? editSetup('car') : selected === 1 ? editSetup('customer') : goToMenu()} />
      <main className="sale-desk-body" ref={scrollPane}>
        {draft.vehicleId && flowScreen !== 'car' && <div className="sales-flow-context">
          <div className="sale-overview-car">{vehicle && <SaleVehiclePhoto car={vehicle} />}<span><strong>{draft.vehicle}</strong><small>{[draft.registration, saleMoney(pence(draft.price))].filter(Boolean).join(' · ')}</small></span><Button variant="ghost" aria-label="Change car" disabled={busy} onClick={() => editSetup('car')}>Change</Button></div>
          <div className="sale-overview-customer"><UserRound size={21} aria-hidden="true"/><span><strong>{draft.customer || 'Choose customer'}</strong><small>{record?.reference || 'New sale'}</small></span><Button variant="ghost" aria-label="Change customer" disabled={busy} onClick={() => editSetup('customer')}>Change</Button></div>
          <SaleProgress sale={record} showDetail={!showSummaryAtTop || (!nextStep && !depositConfirmation)} />
          {compactFooter && showSummaryAtTop && <dl className="sale-overview-totals" aria-label="Sale amounts">
            <div><dt>Received</dt><dd>{saleMoney(actualPaymentsReceived)}</dd></div>
            <div data-balance={displayedBalance === 0 ? 'settled' : 'due'}><dt>{mobileBalanceLabel}</dt><dd>{saleMoney(displayedBalance)}</dd></div>
          </dl>}
        </div>}
        <div className="sale-desk-content" id="sale-flow-content">
          <div className="sale-desk-section-heading">
            <h1 ref={heading} tabIndex={-1}>{screenHeading}</h1>
            {!['car', 'customer', 'menu'].includes(flowScreen) && (!compactFooter || mobileAction) && <Button variant="ghost" disabled={busy} onClick={goToMenu}><ArrowLeft size={16} aria-hidden="true" />All actions</Button>}
          </div>
          {problem && <div ref={setupError} tabIndex={-1} role="alert" className="invoice-error">{problem}{/another device|reload/i.test(problem) && record && <Button variant="outline" disabled={busy} onClick={() => run(async () => {const latest = await customFetch<{sale: SaleWorkspaceRecord}>(`/api/sale-workspace/${record.id}`);accept({sale: latest.sale}, true);setMessage('Latest sale loaded.');})}>Reload latest sale</Button>}</div>}
          {message && <p role="status" className="invoice-message">{message}</p>}
          {isOverview && record && <SaleHandoverSummary sale={record} />}
          {quickSale && <ol className="sale-quick-progress" aria-label="Quick sale progress">
            <li aria-current={flowScreen === 'payment' ? 'step' : undefined}><span>Step 1 of 4</span>Record payment</li>
            <li aria-current={flowScreen === 'invoice' && !issued ? 'step' : undefined}><span>Step 2 of 4</span>Review invoice</li>
            <li aria-current={flowScreen === 'invoice' && issued ? 'step' : undefined}><span>Step 3 of 4</span>Mark sold</li>
            <li aria-current={flowScreen === 'handover' ? 'step' : undefined}><span>Step 4 of 4</span>Record collection</li>
          </ol>}
          {released && <p className="invoice-message" data-tone="warning">This reservation was released. Its documents and payment history are kept. Start a new sale to sell this car.</p>}
          {released && total && (total.confirmedPaid !== 0 || total.pending > 0) && <p role="alert" className="invoice-error">Review this released reservation’s payments. {total.confirmedPaid !== 0 && `Net received: ${saleMoney(total.confirmedPaid)}. `}{total.pending > 0 && `Pending: ${saleMoney(total.pending)}. `}These amounts do not mean the purchase price is due.</p>}
          {needsCorrectionReview && <p role="alert" className="invoice-error">This sale has refunds or external corrections. Review the original paperwork before relying on the calculated balance.</p>}
          {stockRefundDue > 0 && flowScreen === 'history' && <p className="invoice-message" data-tone="warning">This car belongs to another sale. Record the {saleMoney(stockRefundDue)} refund here once it has been paid.</p>}
          {showNextStep && <section className="sales-flow-next" aria-label="Next step">
            <div>
              <h2>Next step</h2>
              <p>{nextStepBlock || nextStep.note}</p>
              {nextStepDocument && <p className="sales-receipt-reference"><Invoice size={16} aria-hidden="true" /> {nextStepDocument.type === 'receipt' ? 'Deposit receipt' : 'Sales invoice'} <strong>{nextStepDocument.number}</strong></p>}
            </div>
            {mobileAction !== nextStepAction && nextStepAction}
          </section>}
          {depositConfirmation && <section className="sales-flow-confirmation" aria-label="Deposit confirmation">
            <h2><Check size={22}/>Let the customer know</h2>
            <p>{saleMoney(depositConfirmation.paymentAmountPence ?? 0)} received for {depositConfirmation.snapshot.draft.vehicle}. {record?.lifecycle?.status === 'reserved' ? 'The car is reserved.' : 'The payment has been recorded.'}</p>
            <p className="sales-receipt-reference"><Invoice size={17} aria-hidden="true" /> Deposit receipt <strong>{depositConfirmation.number}</strong></p>
            {depositConfirmation.snapshot.draft.email && <p className="[overflow-wrap:anywhere]">Email on this receipt: {depositConfirmation.snapshot.draft.email}</p>}
            <div className="sales-flow-secondary">
              {mobileAction !== confirmationAction && confirmationAction}
              <Button variant="outline" disabled={busy} onClick={() => documentAction(depositConfirmation,'download')}><Download size={18}/>Download receipt</Button>
              <Button variant="outline" disabled={busy} onClick={() => documentAction(depositConfirmation,'print')}><Printer size={18}/>Print receipt</Button>
              <Button variant="ghost" disabled={busy} onClick={goToMenu}>Back to sale</Button>
              {resumeAfterPayment && <Button variant="outline" disabled={busy} onClick={resumeBlockedAction}>Back to {resumeAfterPayment === 'invoice' ? 'invoice' : 'collection or delivery'}</Button>}
            </div>
            {receiptEmailProblem && <p id={receiptEmailAvailabilityId}>{receiptEmailProblem}</p>}
            {receiptRecipientChanged && canCorrect && <Button variant="outline" disabled={busy || dirty} onClick={() => openCorrection('customer')}>Review customer details</Button>}
            {record && !receiptEmailSent && <MarkDepositConfirmationShared key={`${record.id}:${depositConfirmation.id}`} sale={record} document={depositConfirmation} onSaved={sale => { accept({sale}); showMenu(); setMessage('Deposit confirmation marked as shared.'); }} disabled={busy || !canRecordPayments} onBusyChange={setChildBusy} />}
          </section>}
          {isOverview && <>
          <section className="sale-overview-actions" aria-label="Sale actions">
          <h2>Sale actions</h2>
          {canStartQuickSale && <div className="sale-quick-start">
            <div><h3>Quick sale</h3><p>For a car paid in full and collected from the showroom.</p></div>
            <Button variant="outline" onClick={startQuickSale}>Start quick sale<ArrowRight size={16} aria-hidden="true" /></Button>
          </div>}
          <SalesActionMenu canAddDelivery={Boolean(latestInvoice && record?.draft.fulfilment?.method !== 'delivery')} handoverCompleted={handoverCompleted} includeReturn={false} includeRequest={!requestIsNextStep} onChoose={chooseAction} disabled={busy} requestTitle={sold ? 'Request a payment' : undefined} unavailable={unavailable} />
          <div className="sale-overview-links">
            <Button variant="outline" disabled={busy} onClick={openPaymentHistory}><History size={16} aria-hidden="true" />Payments and documents</Button>
            {customerUpdate}
            <Button variant="ghost" disabled={busy} onClick={() => editSetup('extras')}><Plus size={16} aria-hidden="true" />Extras or part exchange</Button>
            {record?.stockActionBlock && record.draft.vehicleId === draft.vehicleId && !released && !returned &&
              <Button variant="ghost" disabled={busy || Boolean(openingId)} onClick={() => void open(record)}>Check car availability</Button>}
          </div>
          {(canCorrect || (canManageSales && canRefundPayments)) && <details className="sale-overview-more">
            <summary>More actions <ChevronDown size={16} aria-hidden="true" /></summary>
            <div>
              {canCorrect && <Button variant="outline" disabled={busy || dirty} onClick={() => openCorrection()}>Correct something</Button>}
              {canManageSales && canRefundPayments && <>
                <Button variant="outline" disabled={busy || Boolean(unavailable.return)} aria-describedby={unavailable.return ? returnHelpId : undefined} onClick={() => chooseAction('return')}>{returned ? 'View return details' : 'Return or change a car'}</Button>
                {unavailable.return && <small id={returnHelpId}>{unavailable.return}</small>}
              </>}
            </div>
          </details>}
          </section>
          {record && <>
            <SaleTimeline sale={record}/>
            <SaleTeamAssignment key={record.id} sale={record} canManage={canManageSales} disabled={busy || saleDraftDirty || handoffDraftDirty} onSaved={sale => accept({ sale })} onSaving={setChildBusy} onDirtyChange={setTeamDraftDirty} />
          </>}</>}
          {record && (isOverview || flowScreen === 'history' || flowScreen === 'handover') && <SaleStaffHandoff
            key={`${record.id}:${flowScreen}`}
            sale={record}
            mode={flowScreen === 'history' ? 'check-payment' : flowScreen === 'handover' ? 'arrange-collection' : 'overview'}
            canManage={canManageSales}
            currentStaffId={access.data?.user?.authUserId}
            focusedTaskId={focusedStaffTask?.id}
            focusRequest={focusedStaffTask?.request}
            disabled={busy || saleDraftDirty || teamDraftDirty}
            onSaved={(sale, options) => accept({ sale }, options?.reloaded)}
            onSaving={setChildBusy}
            onDirtyChange={setHandoffDraftDirty}
          />}
          {!isOverview && (depositConfirmation || (flowScreen === 'handover' && !handoverCompleted) || (flowScreen === 'invoice' && sold)) && customerUpdate}
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
                      {reviewingEnquiry && <section className="sales-enquiry-review" aria-label="Car from this enquiry">
                        <h2>Car from this enquiry</h2>
                        <p>Check the agreed price and the customer’s details before opening the sale.</p>
                        <div className="invoice-field-grid">{field("price", "Agreed vehicle price (£)")}</div>
                      </section>}
                      <h2>Customer details</h2>
                      <RecentCustomerFields
                        value={{ customerName: draft.customer, phone: draft.phone, email: draft.email }}
                        customers={customerOptions}
                        disabled={Boolean(record?.completedAt)}
                        suggestionsDisabled={Boolean(rows.length) || reviewingEnquiry}
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
                        {!record?.completedAt && !rows.length && <small className="invoice-field-wide">{reviewingEnquiry ? 'Enter the billing address agreed with the customer.' : 'Choosing a recent customer clears this address. Confirm their current address for this sale.'}</small>}
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
                            {canManageSales && (
                              <div className="invoice-part-exchange-check">
                                <PartExchangeCheck key={record?.id} registration={row.registration} />
                              </div>
                            )}
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
            {dealSection === 'extras' && returnToInvoice}
            </section>
            {mobileAction !== setupAction && <div className="sale-desk-section-actions">{setupAction}</div>}
            {record && <details className="sale-desk-fold"><summary>Sale actions</summary>
              {record.lifecycle?.status === 'reserved' && !record.completedAt && canManageSales && <div className="invoice-draft-delete"><p>Release this reservation when received and pending payments are clear.</p><Button variant="outline" disabled={busy || dirty || total?.confirmedPaid !== 0 || total?.pending !== 0} onClick={() => {setProblem('');setReleaseReservationOpen(true);}}>Release reservation</Button></div>}
              {canDeleteDraft && <div className="invoice-draft-delete"><p>No issued invoice or payment is attached to this removable draft.</p><Button variant="outline" disabled={busy || dirty} onClick={() => {setProblem('');setDeleteDraftOpen(true);}}><Trash2 size={16}/>Delete draft</Button></div>}
              {!canDeleteDraft && record.lifecycle?.status !== 'reserved' && <p>Issued documents and payment history are retained with this sale.</p>}
            </details>}
          </>}
          {flowScreen === 'return' && <>
            {!record?.completedAt ? <section className="sale-desk-sheet"><h2>Find the original sale</h2><p>Choose the completed sale for the car being returned. Its customer, payments and invoice will be filled in.</p><Button onClick={() => {setDraft(null);setRecord(null);setFilter(draft.registration);setMessage('Find and open the original completed sale, then choose Return or change a car.');}}>Find the original sale</Button></section> : <>
            {!returnChoice && <div className="sales-flow-return-choices">
              <button type="button" disabled={busy || Boolean(plainReturnBlock)} onClick={() => setReturnChoice('return')}><strong>Return car</strong><span>{plainReturnBlock || 'Take the car back and work out any refund.'}</span></button>
              <button type="button" disabled={busy || Boolean(replacementBlock)} onClick={() => setReturnChoice('replace')}><strong>Return and replace</strong><span>{replacementBlock || 'Use the agreed credit towards another car.'}</span></button>
            </div>}
            {returnChoice === 'return' && <SaleReturnCar key={`return-car:${record.id}`} sale={record} initialExpanded onSaved={sale => accept({sale})} disabled={operationBusy || detailsDirty || Boolean(payment.amount.trim())} canReturn={canManageSales && canRefundPayments} canInspect={canManageSales} onDirtyChange={setReturnDraftDirty} onBusyChange={setChildBusy} onRefund={() => {setFlowScreen('history');setWorkspaceTab('payments');}}/>}
            {returnChoice === 'replace' && <SaleReturnReplace key={`return:${record.id}`} initialExpanded sale={record} cars={stock?.cars ?? []} onSaved={sale => accept({sale})} onOpenSale={id => void open({id})} disabled={operationBusy || detailsDirty || Boolean(payment.amount.trim())} canReturn={canManageSales && canRefundPayments} canInspect={canManageSales} onDirtyChange={setReturnDraftDirty} onBusyChange={setChildBusy}/>}
            </>}
          </>}
          {flowScreen === 'request' && canRecordPayments && (payment.amount.trim() ? <section className="sale-desk-sheet"><p>You have an unfinished payment. Save it if the money was received, or clear its amount before requesting a deposit.</p><Button disabled={busy} onClick={() => chooseAction(payment.kind === 'deposit' ? 'deposit' : 'payment')}>Return to unfinished payment</Button></section> : record && !detailsDirty ? <SalePaymentRequests sale={record} onSaved={sale=>accept({sale})} onDirtyChange={setRequestDraftDirty} onBusyChange={setChildBusy} onRecordDeposit={recordRequestedDeposit} showMoneySummary={false} canReserve={canManageSales} defaults={paymentDefaults.data} canEditPaymentInstructions={access.data?.permissions.includes('integrations.manage') === true} actionOnly /> : <section className="sale-desk-sheet"><p>Save the car and customer details to prepare the request.</p><Button disabled={busy} onClick={save}>Save and continue</Button></section>)}
          {record && canRefundPayments && flowScreen === 'history' && <SaleReplacementRefund key={`refund-credit:${record.id}`} sale={record} onSaved={sale => accept({sale})} disabled={operationBusy || detailsDirty || Boolean(payment.amount.trim())} onDirtyChange={setRefundDraftDirty} onBusyChange={setChildBusy}/>}
          {['payment', 'deposit', 'history'].includes(flowScreen) && <section className="sale-desk-sheet sale-desk-payments">
            {flowScreen === 'history' && <div className="sale-desk-inline-heading"><div><h2>Money received</h2></div>{returnToInvoice}{!unavailable.payment && <Button onClick={() => chooseAction('payment')} disabled={busy}><Plus size={16}/>Take a payment</Button>}</div>}
            {!rows.length && flowScreen === 'history' && <p className="sale-desk-empty-inline">No payments recorded.</p>}
            {flowScreen === 'history' && paymentRequests.length > 0 && <details className="sale-desk-fold">
              <summary>Original payment requests ({paymentRequests.length})</summary>
              <div className="sale-desk-document-list">
                {[...paymentRequests].reverse().map(request => {
                  const document = record?.documents.find(item => item.id === request.documentId);
                  return <div key={request.id}>
                    <Invoice size={19} aria-hidden="true" />
                    <span>
                      <strong>{request.kind === 'deposit' ? 'Deposit' : 'Payment'} requested: {saleMoney(request.amountPence)}</strong>
                      <small>{request.reference} · Pay by {paymentDate(request.dueDate)}</small>
                      {request.status === 'accepted' && typeof request.acceptedAmountPence === 'number' && <small>{saleMoney(request.acceptedAmountPence)} accepted as the deposit</small>}
                      {request.status === 'cancelled' && <small>Cancelled</small>}
                    </span>
                    {document && <Button variant="outline" disabled={busy} onClick={() => openDocument(document)}>View original request</Button>}
                  </div>;
                })}
              </div>
            </details>}
            {!quickSale && payment.amount.trim() && <p className="invoice-message">An unsaved payment is kept here. Save it before issuing documents or leaving this sale.</p>}
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
                                  {row.stockConflictReconciliation ? 'Received for refund' : row.status === 'confirmed' && row.kind === 'refund' ? 'Refund recorded' : row.status === 'confirmed' && row.signedAmountPence < 0 ? 'Correction recorded' : row.status}
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
                          id={paymentFormId}
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
                              <div className="sales-flow-amounts">{(flowScreen === 'deposit' ? depositPresets : [total!.balance]).filter(value => value <= total!.balance).map(value => <button type="button" key={value} onClick={() => setPayment({...payment, amount:(value/100).toFixed(2), received:false})}>{flowScreen === 'payment' ? 'Full balance ' : value === suggestedDeposit ? 'Suggested ' : ''}{saleMoney(value)}</button>)}</div>
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
                          {draft?.vehicleId && payment.kind !== 'deposit' && !sold && record?.lifecycle?.status !== 'reserved' && (
                            <p className="invoice-note">Saving the first received payment reserves the car and removes it from available stock.</p>
                          )}
                          {resumeAfterPayment && !payment.amount.trim() && <Button type="button" variant="outline" disabled={busy} onClick={resumeBlockedAction}>Back to {resumeAfterPayment === 'invoice' ? 'invoice' : 'collection or delivery'}</Button>}
                          {pence(payment.amount) > total!.balance && (
                            <p role="alert" className="invoice-error">
                              This payment exceeds the remaining balance.
                            </p>
                          )}
                          {mobileAction !== savePaymentAction && savePaymentAction}
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
                        {issued.number} · {issued.snapshot.draft.customer}
                      </p>
                      <small>
                        {[issued.snapshot.draft.vehicle, issued.snapshot.draft.registration].filter(Boolean).join(' · ')}
                      </small>
                      {issued.snapshot.draft.email && <small className="block [overflow-wrap:anywhere]">Email on this copy: {issued.snapshot.draft.email}</small>}
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
                      disabled={busy || Boolean(issuedEmailProblem)}
                      aria-describedby={issuedEmailProblem ? emailAvailabilityId : undefined}
                      onClick={event => reviewDocumentEmail(issued, event.currentTarget)}
                    >
                      <Mail size={17} /> Email customer
                    </Button>

                  </div>
                  {issuedEmailProblem && <div id={emailAvailabilityId} role="status" className="invoice-note"><p>{issuedEmailProblem}</p>{!canEmailCustomer && features.isError && <Button variant="outline" disabled={features.isFetching} onClick={() => void features.refetch()}>Retry email availability</Button>}</div>}
                  {issuedRecipientChanged && canCorrect && <div className="sales-flow-secondary">
                    <Button variant="outline" disabled={busy || dirty} onClick={() => openCorrection('customer')}>Review customer details</Button>
                    {canReviewUpdatedInvoice && <Button variant="outline" disabled={busy || dirty} onClick={() => {
                      chooseAction('invoice');
                      setKind(issued.invoiceKind === 'deposit' ? 'deposit' : 'full');
                    }}>Review updated invoice</Button>}
                  </div>}

                  {issuedFullInvoice && !issuedInvoiceIsCurrent && (
                    <div className="invoice-note" role="status">
                      <p>This saved invoice shows the details at the time it was issued.</p>
                      {latestInvoice && invoiceIsCurrent && latestInvoice.id !== issued.id ? (
                        <Button variant="outline" disabled={busy} onClick={() => openDocument(latestInvoice)}>Review current invoice</Button>
                      ) : canUpdateStaleInvoice && !(issuedRecipientChanged && canReviewUpdatedInvoice) ? (
                        <Button variant="outline" disabled={busy || Boolean(payment.amount.trim())} onClick={() => chooseAction('invoice')}>Create updated invoice</Button>
                      ) : null}
                    </div>
                  )}
                  {issued.type === 'invoice' && issued.invoiceKind !== 'deposit' && record && <SoldVehicleCustomerReview key={`sold-customers:${record.id}:${record.lifecycle?.status ?? 'draft'}`} saleId={record.id} />}
                  {issuedInvoiceIsCurrent && !sold && !released && !returned &&
                    canManageSales && canRecordPayments &&
                    !soldChoice && (
                      <section className="invoice-sold-question">
                        <h2>Should this car be marked sold?</h2>
                        <p>
                          Marking it sold removes it from the customer website.
                          Your invoice and payments stay saved.
                        </p>
                        {soldBlock && <p id={soldAvailabilityId} className="invoice-note">{soldBlock}</p>}
                        {checklistPanel()}
                        {total!.balance > 0 && (
                          <>
                            <p className="invoice-message" data-tone="warning">
                              {saleMoney(total!.balance)} is still due. Removing
                              the car does not settle this balance.
                            </p>
                            <Button variant="outline" disabled={busy} onClick={() => {
                              setResumeInvoice(issued.id);
                              openPaymentHistory();
                            }}>Review payments</Button>
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
                            aria-describedby={soldBlock ? soldAvailabilityId : undefined}
                            disabled={
                              busy || Boolean(soldBlock) || Boolean(payment.amount.trim()) || detailsDirty ||
                              !checklistReady ||
                              total!.balance < 0 ||
                              (total!.balance > 0 && !outstandingAccepted) ||
                              !draft.vehicleId
                            }
                            onClick={() =>
                              run(async () => {
                                await command("/finish-invoice-sale", {
                                  reviewedInvoiceId: issued.id,
                                  acknowledge: true,
                                  acknowledgeOutstanding: outstandingAccepted,
                                });
                                await client.invalidateQueries({
                                  queryKey: getGetStockQueryKey(),
                                });
                                await client.invalidateQueries({ queryKey: soldVehicleFollowUpsQueryKey });
                                setSoldChoice(true);
                                if (quickSale && canHandover) chooseAction('handover');
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
                      This deposit invoice shows the payment and balance when it was issued.
                      {record?.lifecycle?.status === 'reserved' && !returned && !sold && ' The car is currently reserved.'}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (quickSale) {
                        showMenu();
                        return;
                      }
                      setIssued(null);
                      setWorkspaceTab("payments");
                      setFlowScreen("payment");
                      setStep(2);
                      setReviewed(false);
                    }}
                  >
                    Return to this sale
                  </Button></section> : <>
              <details className="sale-desk-fold" open={flowScreen === 'history' ? true : undefined}><summary>Saved documents ({record?.documents.length ?? 0})</summary><div className="sale-desk-inline-heading"><div><p>Issued paperwork keeps its original details.</p></div>{!unavailable.invoice && flowScreen === 'history' && <Button onClick={() => chooseAction('invoice')} disabled={busy}><Plus size={16}/>Create invoice</Button>}</div>
                {record?.documents.length ? <SaleDocumentList documents={record.documents} disabled={busy} onOpen={openDocument} /> : <p className="sale-desk-empty-inline">No documents issued yet. Create an invoice when the deal details are ready.</p>}
              </details>
              {flowScreen === 'invoice' && canRecordPayments && !released && !returned && <section className="sale-desk-sheet sale-desk-invoice-compose"><h2>Invoice details</h2>
                {!quickSale && <>
                  <div className="sale-desk-invoice-kinds" role="group" aria-label="Invoice type">{(['full','deposit'] as const).map(type => <Button key={type} variant={kind === type ? 'default' : 'outline'} aria-pressed={kind === type} disabled={busy || (type === 'deposit' && Boolean(depositInvoiceBlock))} aria-describedby={type === 'deposit' && depositInvoiceBlock ? depositInvoiceHelpId : undefined} onClick={() => {setKind(type);setReviewed(false);}}><Invoice size={16}/>{type === 'full' ? 'Sales invoice' : 'Received deposit invoice'}</Button>)}</div>
                  {depositInvoiceBlock && <p id={depositInvoiceHelpId} className="invoice-note">{depositInvoiceBlock}</p>}
                </>}
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
                            {saleMoney(actualPaymentsReceived)}
                            <small>
                              {
                                rows.filter((row) => row.status === "confirmed")
                                  .length
                              }{" "}
                              dated payment entries included
                            </small>
                          </dd>
                        </div>
                        {transferredCredit !== 0 && (
                          <div>
                            <dt>Transferred credit</dt>
                            <dd>{saleMoney(transferredCredit)}</dd>
                          </div>
                        )}
                        <div data-kind="balance" data-balance={total!.balance === 0 ? 'settled' : total!.balance < 0 ? 'credit' : 'outstanding'}>
                          <dt>Balance remaining</dt>
                          <dd>{saleMoney(total!.balance)}</dd>
                        </div>
                      </dl>
</details>
                {record && !detailsDirty ? <InvoiceVehicleReview key={`${record.id}:${record.revision}`} sale={record}
                  disabled={busy || Boolean(unavailable.invoice) || Boolean(payment.amount.trim())} onApproval={setVehicleApproval} />
                  : <p className="invoice-note">Save the sale details before checking the vehicle.</p>}
                <label className="invoice-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy || Boolean(payment.amount.trim())}/>I have checked the customer, vehicle, agreed price and received payments.</label>
                {payment.amount.trim() && <div className="invoice-error">
                  <p>Save or clear the payment entry in Payments before creating an invoice.</p>
                  <Button variant="outline" disabled={busy} onClick={() => openUnfinishedPayment('invoice')}>Open unfinished payment</Button>
                </div>}
                <p className="invoice-note">Creating an invoice keeps the car’s current availability. You can mark it sold after reviewing the saved invoice.</p>
                {mobileAction !== createInvoiceAction && createInvoiceAction}
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
            <section className="sale-desk-sheet">
              {!handoverCompleted && payment.amount.trim() ? <div className="invoice-error">
                <p>Save or clear the payment entry in Payments before confirming the handover.</p>
                <Button variant="outline" disabled={busy} onClick={() => openUnfinishedPayment('handover')}>Open unfinished payment</Button>
              </div> : record && (handoverCompleted || !detailsDirty) ? <SaleHandover
                key={`handover:${record.id}`}
                sale={record}
                onSaved={sale => {
                  accept({ sale });
                  if (sale.draft.fulfilment?.completedAt || sale.draft.fulfilment?.method === 'delivery') setQuickSale(false);
                }}
                onReviewPayments={canRecordPayments && total!.balance > 0 && !total!.pending && !needsCorrectionReview
                  ? () => chooseAction('payment') : openPaymentHistory}
                onReviewInvoice={canManageSales || canRecordPayments ? () => {
                  if (latestInvoice && invoiceIsCurrent) openDocument(latestInvoice);
                  else if (canRecordPayments && !separateDeliveryInvoice) chooseAction('invoice');
                  else openPaymentHistory();
                } : undefined}
              /> : <><SaleHandoverFields draft={draft} value={handoverDefaults(draft)} onChange={value => update('fulfilment', value)} disabled={busy || !canManageSales || Boolean(record?.draft.fulfilment?.completedAt)}/><p className="invoice-note">Save these details to continue with the handover.</p><Button onClick={save} disabled={busy || !canManageSales}>Save arrangements</Button></>}
            </section>
            {record?.draft.fulfilment?.method === 'delivery' && canManageSales && (handoverCompleted || (!detailsDirty && !payment.amount.trim())) && <>
              {!handoverCompleted && <SaleDeliveryCharge sale={record} onSaved={sale => accept({ sale })} onBusyChange={setChildBusy} />}
              <details className="sale-desk-fold">
                <summary>Delivery evidence and signed paperwork</summary>
                <SaleDeliveryEvidence saleId={record.id} revision={record.revision} readOnly={handoverCompleted} />
              </details>
            </>}
            {handoverCompleted && record?.draft.fulfilment?.method === 'delivery' && record.documents.filter(doc => doc.type === 'handover').slice(-1).map(doc => (
              <Button key={doc.id} variant="outline" disabled={busy || Boolean(documentEmailProblem(doc))}
                title={documentEmailProblem(doc)} onClick={event => reviewDocumentEmail(doc, event.currentTarget)}>
                Email delivery confirmation
              </Button>
            ))}
            {!handoverCompleted && <details className="sale-desk-fold"><summary>Before handing over the car</summary>{checklistPanel()}</details>}
            {record && (record.completedAt || record.lifecycle?.status === 'sold') && <details className="sale-desk-fold"><summary>Customer follow-up</summary><SoldVehicleCustomerReview saleId={record.id} /></details>}
          </>}
        </div>
        {!compactFooter && showBreakdown && <aside className="sales-flow-breakdown" aria-label="Payment breakdown">
          <h2>Payment breakdown</h2>
          {moneyBreakdown}
        </aside>}
        {flowScreen === 'history' && record && <SaleTimeline sale={record}/>}

      </main>
      {compactFooter ? <footer className="sales-flow-mobile-footer" aria-label="Sale summary and actions" data-has-balance={Boolean(showBreakdown)} onKeyDown={event => {
        if (event.key !== 'Escape' || !moneyBreakdownOpen) return;
        event.stopPropagation();
        setMoneyBreakdownOpen(false);
        moneyBreakdownButton.current?.focus();
      }}>
        {showBreakdown && <>
          <button type="button" ref={moneyBreakdownButton} className="sales-flow-mobile-balance" data-due={displayedBalance !== 0}
            aria-expanded={moneyBreakdownOpen} aria-controls={moneyBreakdownId} onClick={() => setMoneyBreakdownOpen(open => !open)}>
            <span>{mobileBalanceLabel}<strong>{saleMoney(displayedBalance)}</strong></span><ChevronDown size={16} aria-hidden="true" />
            <span className="sr-only">Payment breakdown</span>
          </button>
          <section id={moneyBreakdownId} className="sales-flow-breakdown sales-flow-mobile-breakdown" aria-label="Payment breakdown"
            hidden={!moneyBreakdownOpen} tabIndex={moneyBreakdownOpen ? 0 : undefined}>
            <h2>Payment breakdown</h2>
            {moneyBreakdown}
          </section>
        </>}
        <div className="sales-flow-mobile-action">{mobileAction || backAction}</div>
        <small className="sr-only" role="status">{busy ? 'Saving…' : detailsDirty ? 'Unsaved details' : record ? 'Saved' : 'Not saved yet'}</small>
      </footer> : <footer className="sales-flow-footer">
        {backAction}
        {total && !showSummaryAtTop && <div className="sales-flow-money" aria-label="Sale amounts">
          <span>Car price <strong>{saleMoney(total.price)}</strong></span>
          <span>Delivery <strong>{saleMoney(deliveryAmount)}</strong></span>
          <span>Received <strong>{saleMoney(actualPaymentsReceived)}</strong></span>
          <span>Agreed total <strong>{saleMoney(total.totalDue)}</strong></span>
          <span className="sales-flow-money-balance" data-due={displayedBalance !== 0}>{balanceLabel} <strong>{saleMoney(displayedBalance)}</strong></span>
        </div>}
        <small role="status">{busy ? 'Saving…' : detailsDirty ? 'Unsaved details' : record ? 'Saved' : 'Not saved yet'}</small>
      </footer>}
    </>}
      {correction && record && <SaleCorrections
        key={record.id}
        sale={record}
        initialIssue={correction.issue}
        canManageSales={canManageSales}
        canRecordPayments={canRecordPayments}
        canRefundPayments={canRefundPayments}
        disabled={operationBusy || dirty}
        instructions={correctionPaperwork.data?.correctionSettings?.instructions}
        onBusyChange={setChildBusy}
        onClose={() => setCorrection(null)}
        onSaved={(sale, document, next?: 'updated-invoice') => {
          accept({sale});
          if (document) displayDocument(document);
          else if (next === 'updated-invoice') {
            setFlowScreen('invoice'); setWorkspaceTab('invoices'); setIssued(null);
            setComposeInvoice(true); setReviewed(false);
            setKind(issued?.invoiceKind === 'deposit' ? 'deposit' : 'full');
          }
          setMessage('Correction saved.');
          setCorrection(null);
        }}
      />}
      {emailReview && <Dialog open onOpenChange={open => { if (!open && !busy) { setEmailReview(null); setProblem(''); } }}>
        <DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy} aria-busy={busy} onCloseAutoFocus={restoreEmailReviewFocus}>
          <DialogHeader>
            <DialogTitle>Email this document?</DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere]">Send the saved PDF to <strong>{emailReview.snapshot.draft.email.trim()}</strong>.</DialogDescription>
          </DialogHeader>
          <p className="text-sm [overflow-wrap:anywhere]">{emailReview.title} · {emailReview.number}</p>
          {(reviewedEmailProblem || problem) && <p role="alert" className="invoice-error">{reviewedEmailProblem || problem}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => { setEmailReview(null); setProblem(''); }}>Go back</Button>
            <Button disabled={busy || Boolean(reviewedEmailProblem)} onClick={() => email(emailReview)}>{busy ? 'Sending…' : 'Send email'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {pendingConfirmation && record && <ConfirmSavedPayment key={pendingConfirmation.id} sale={record} payment={pendingConfirmation} busy={busy} problem={problem} onClose={() => {if (!busy) setPendingConfirmation(null);}} onConfirm={input => run(async () => {
        const confirmed = pendingConfirmation;
        const result = await command(`/payments/${confirmed.id}/confirm`, input);
        setPendingConfirmation(null);
        if (confirmed.kind === 'deposit' && result.document) {setConfirmationDocument(result.document);setFlowScreen('deposit');setPaymentFormOpen(false);}
        setMessage(`${saleMoney(confirmed.amountPence)} received${!sold && record.lifecycle?.status !== 'reserved' && result.sale.lifecycle?.status === 'reserved' ? '. Car reserved' : ''}.`);
        void client.invalidateQueries({queryKey:getGetStockQueryKey()}).catch(() => {});
      })}/>}
      {stockConflictRefund && <Dialog open onOpenChange={open => { if (!open && !busy) { setStockConflictRefund(null); setProblem(''); } }}>
        <DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy} aria-busy={busy} onCloseAutoFocus={restoreMobilePaymentFocus}>
          <DialogHeader>
            <DialogTitle>Record money for refund?</DialogTitle>
            <DialogDescription>Another customer has reserved or bought this car. If {saleMoney(pence(payment.amount))} already arrived, record it here so you can account for the refund. The other sale keeps the car.</DialogDescription>
          </DialogHeader>
          <label className="invoice-field-wide">Reason<Input value={stockConflictRefund.reason} maxLength={1000} disabled={busy} onChange={event => setStockConflictRefund({ ...stockConflictRefund, reason: event.target.value })}/></label>
          <label className="invoice-check"><input type="checkbox" checked={stockConflictRefund.received} disabled={busy} onChange={event => setStockConflictRefund({ ...stockConflictRefund, received: event.target.checked })}/>I confirm the money arrived and must be recorded for refund.</label>
          {problem && <p role="alert" className="invoice-error">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => { setStockConflictRefund(null); setProblem(''); }}>Go back</Button>
            <Button disabled={busy || !stockConflictRefund.received || !stockConflictRefund.reason.trim()} onClick={recordPaymentForRefund}>{busy ? 'Recording…' : 'Record for refund'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {duplicateConfirmOpen && <Dialog open onOpenChange={open => { if (!busy) setDuplicateConfirmOpen(open); }}><DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy} onCloseAutoFocus={restoreMobilePaymentFocus}><DialogHeader><DialogTitle>Is this a separate payment?</DialogTitle><DialogDescription>A payment for {saleMoney(pence(payment.amount))} with the same date, method and reference is already recorded.</DialogDescription></DialogHeader><label className="invoice-check"><input type="checkbox" checked={duplicateAccepted} onChange={event => setDuplicateAccepted(event.target.checked)}/>This is a separate payment. Record it as well.</label><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDuplicateConfirmOpen(false)}>Go back</Button><Button disabled={busy || !duplicateAccepted} onClick={recordPayment}>Record separate payment</Button></DialogFooter>{problem && <p role="alert">{problem}</p>}</DialogContent></Dialog>}
      {depositConfirmOpen && draft && <Dialog open onOpenChange={open => { if (!busy) setDepositConfirmOpen(open); }}><DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy} onCloseAutoFocus={restoreMobilePaymentFocus}>
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
