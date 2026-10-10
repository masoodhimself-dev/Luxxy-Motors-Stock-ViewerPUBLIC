import { ClassicReceipt } from '@/components/sales-demo/classic-receipt';
import { invoiceBranding } from '@workspace/vehicle-meta';
import { CompleteSaleDialog } from "@/components/sales-demo/complete-sale-dialog";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  HttpApiError as ApiError,
} from "@workspace/api-client-react";
import type {
  SaleWorkspaceRecord,
  SaleWorkspaceMutation,
  SaleWorkspaceDocument,
  SaleWorkspaceDraft,
  SaleWorkspacePayment,
  SaleWorkspacePaymentInput,
} from "@workspace/vehicle-meta";
import {
  PaymentDialog,
  ReversePaymentDialog,
  PaymentLedger,
  DeliveryPanel,
  HandoverDialog,
  salePaymentState,
} from "@/components/sales-demo/sales-controls";
import {
  SalesConnections,
  DocumentDelivery,
} from "@/components/sales-demo/sales-connections";
import { HistoryLinks } from "@/components/portal/history-links";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  Printer,
  Plus,
  FileText,
  UserRound,
  CarFront,
  ArrowLeftRight,
  WalletCards,
  ClipboardCheck,
  ChevronDown,
} from "lucide-react";
import "@/sales-workspace.css";
import { SalesDocument } from "@/components/sales-demo/sales-document";
import { useStock } from "@/lib/stock-context";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import {
  vehicleDisplayTitle,
  vehicleRegistration,
  vehicleRegistrationLabel,
  getThumbnailUrl,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SaleDraft,
  emptyDraft,
  totals,
  errors,
  exchanges,
  payments,
  pence,
  saleRequestId,
  saleStaffLabel,
} from "@/components/sales-demo/model";

import {
  getGetStockQueryKey,
  useGetEnquiries,
  useListReservations,
} from "@workspace/api-client-react";

const KEY = "luxxy.sales-workspace-demo.v1";
const tabs = [
  "Customer",
  "Vehicle",
  "Part exchange",
  "Payments & receipts",
  "Documents",
  "Delivery & handover",
] as const;
const sectionIcons = [
  UserRound,
  CarFront,
  ArrowLeftRight,
  WalletCards,
  FileText,
  ClipboardCheck,
];
const money = (pence: number) =>
  Number.isFinite(pence)
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(pence === 0 ? 0 : pence / 100)
    : "—";
function readDrafts(): SaleDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (d) =>
            d &&
            typeof d.id === "string" &&
            typeof d.price === "string" &&
            typeof d.customer === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export interface SalesWorkspaceProps {
  embedded?: boolean;
  newSaleRequest?: number;
  onExit?: () => void;
}

export function SalesWorkspace({
  embedded = false,
  newSaleRequest = 0,
  onExit,
}: SalesWorkspaceProps) {
  const [, navigate] = useLocation();
  const searchParams = useSearch();
  const consumedSource = useRef("");
  const [customerUrl, setCustomerUrl] = useState("");
  const linkRequest = useRef<{ token: string; expiresAt: string } | null>(null);
  const { stock } = useStock();
  const { settings } = useDealerSettings();
  const enquiries = useGetEnquiries();
  const reservations = useListReservations();
  const [customerSearch, setCustomerSearch] = useState("");
  const sourceCustomers = [
    ...(enquiries.data ?? []).map((item) => ({
      id: "Enquiry " + item.reference,
      sourceEnquiryId: item.id,
      sourceReservationId: "",
      vehicleId: item.vehicleId ?? "",
      vehicle: item.vehicleTitle ?? "",
      registration: item.vehicleRegistration ?? "",
      price: item.vehiclePrice ? String(item.vehiclePrice) : "",
      name: item.customerName,
      email: item.email ?? "",
      phone: item.phone ?? "",
      date: item.createdAt,
    })),
    ...(reservations.data?.reservations ?? []).map((item) => ({
      id: "Reservation " + item.reference,
      sourceEnquiryId: "",
      sourceReservationId: item.id,
      vehicleId: item.vehicleId,
      vehicle: item.vehicleTitle,
      registration: item.vehicleRegistration ?? "",
      price: stock?.cars.find((car) => car.id === item.vehicleId)?.price
        ? String(stock!.cars.find((car) => car.id === item.vehicleId)!.price)
        : "",
      name: item.customerName,
      email: item.email,
      phone: item.phone,
      date: item.createdAt,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const recentCustomers = sourceCustomers
    .filter((item) =>
      `${item.name} ${item.email} ${item.phone} ${item.id}`
        .toLowerCase()
        .includes(customerSearch.toLowerCase()),
    )
    .slice(0, 20);
  const queryClient = useQueryClient();
  const salesQuery = useQuery({
    queryKey: ["sale-workspace"],
    queryFn: () =>
      customFetch<{ sales: SaleWorkspaceRecord[]; preview: boolean }>(
        "/api/sale-workspace",
      ),
    refetchInterval: 15000,
    retry: false,
  });
  const records = salesQuery.data?.sales ?? [];
  const sales = records.map((sale) => sale.draft);
  const [olderDrafts] = useState(readDrafts);
  const [record, setRecord] = useState<SaleWorkspaceRecord | null>(null);
  const [saleSearch, setSaleSearch] = useState("");
  const [saleFilter, setSaleFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const operationLock = useRef(false);
  const retryIds = useRef(new Map<string, string>());
  const [actionProblem, setActionProblem] = useState("");
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<
    "deposit" | "part-payment" | "final-payment"
  >();
  const [completeDialog, setCompleteDialog] = useState(false);
  const paperworkQuery = useQuery({
    queryKey: ["sale-paperwork"],
    queryFn: () =>
      customFetch<{ saleTerms: string; reservationTerms: string; invoiceSettings?: import('@workspace/vehicle-meta').InvoiceSettings }>(
        "/api/sale-workspace/paperwork",
      ),
    refetchOnWindowFocus: true,
  });
  const [pendingConfirmation, setPendingConfirmation] = useState<
    SaleWorkspacePayment | undefined
  >();
  const [reversePayment, setReversePayment] =
    useState<SaleWorkspacePayment | null>(null);
  const [handoverDialog, setHandoverDialog] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const [tab, setTab] = useState(0);
  const [receiptStyle, setReceiptStyle] = useState<"modern" | "classic" | "blank">("modern");
  const [editorView, setEditorView] = useState<"edit" | "preview">("edit");
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const documentType = "Sales invoice" as const;
  const selectedDocument = record?.documents.find(
    (doc) => doc.id === selectedDocumentId,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const sectionNavigation = useRef<HTMLElement>(null);
  const consumedNewSaleRequest = useRef(0);
  const printCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => printCleanup.current?.(), []);
  useEffect(() => {
    const navigation = sectionNavigation.current;
    const active = navigation?.querySelector<HTMLElement>(
      '[aria-current="step"]',
    );
    if (!navigation || !active) return;
    const container = navigation.getBoundingClientRect();
    const button = active.getBoundingClientRect();
    // Keep the selected step in view when Next/Previous changes a section on
    // narrow screens, without scrolling the form or moving keyboard focus.
    if (button.left < container.left)
      navigation.scrollLeft -= container.left - button.left + 16;
    else if (button.right > container.right)
      navigation.scrollLeft += button.right - container.right + 16;
  }, [tab, Boolean(draft)]);
  const dirty = Boolean(draft && JSON.stringify(draft) !== snapshot);
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
  const leave = (exit = false) => {
    if (dirty && !window.confirm("Leave without saving these changes?")) return;
    if (operationLock.current) return;
    setDraft(null);
    setRecord(null);
    setSelectedDocumentId(null);
    setReceiptStyle("modern");
    setMessage("");
    setProblems([]);
    if (exit) {
      if (onExit) onExit();
      else navigate("/portal");
    }
  };
  const open = (sale: SaleDraft, saved?: SaleWorkspaceRecord) => {
    if (operationLock.current) return;
    setRecord(saved ?? null);
    setSelectedDocumentId(null);
    setReceiptStyle("modern");
    setCustomerUrl("");
    linkRequest.current = null;
    setDraft(structuredClone(sale));
    setSnapshot(JSON.stringify(sale));
    setTab(0);
    setEditorView("edit");
    setMessage("");
    setProblems([]);
  };
  useEffect(() => {
    if (
      newSaleRequest <= 0 ||
      newSaleRequest === consumedNewSaleRequest.current
    )
      return;
    consumedNewSaleRequest.current = newSaleRequest;
    if (dirty && !window.confirm("Leave without saving these changes?")) return;
    open(emptyDraft());
  }, [newSaleRequest]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    // History also deep-links to enquiries and reservations. A hidden sale
    // workspace must never interpret those links as a request to start a sale.
    if (embedded && params.get("section") !== "sales") return;
    const sourceEnquiryId = params.get("enquiryId") ?? "",
      sourceReservationId = params.get("reservationId") ?? "",
      saleId = params.get("saleId") ?? "";
    const key = [sourceEnquiryId, sourceReservationId, saleId].join(":");
    if (
      key === "::" ||
      consumedSource.current === key ||
      salesQuery.isLoading ||
      operationLock.current
    )
      return;
    if (dirty && !window.confirm("Leave without saving these changes?")) {
      consumedSource.current = key;
      return;
    }
    const existing = records.find((s) =>
      saleId
        ? s.id === saleId
        : sourceEnquiryId
          ? s.draft.sourceEnquiryId === sourceEnquiryId
          : s.draft.sourceReservationId === sourceReservationId,
    );
    if (existing) {
      consumedSource.current = key;
      open(existing.draft, existing);
      return;
    }
    if (saleId) return;
    const source = sourceCustomers.find((item) =>
      sourceEnquiryId
        ? item.sourceEnquiryId === sourceEnquiryId
        : item.sourceReservationId === sourceReservationId,
    );
    if (!source) return;
    consumedSource.current = key;
    const car = stock?.cars.find((c) => c.id === source.vehicleId);
    open({
      ...emptyDraft(),
      customer: source.name,
      email: source.email,
      phone: source.phone,
      customerSource: source.id,
      sourceEnquiryId: source.sourceEnquiryId,
      sourceReservationId: source.sourceReservationId,
      vehicleId: source.vehicleId,
      vehicle: source.vehicle || (car ? vehicleDisplayTitle(car) : ""),
      registration:
        source.registration || (car ? vehicleRegistration(car) : ""),
      price: source.price || (car?.price ? String(car.price) : ""),
    });
    setMessage(
      "Source linked. Check the agreed sale details before saving. Payments are recorded separately.",
    );
  }, [
    searchParams,
    salesQuery.data,
    enquiries.data,
    reservations.data,
    stock,
    busy,
    embedded,
  ]);
  const update = <K extends keyof SaleDraft>(key: K, value: SaleDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setMessage("");
  };
  const accept = (result: SaleWorkspaceMutation) => {
    setRecord(result.sale);
    setDraft(result.sale.draft);
    setSnapshot(JSON.stringify(result.sale.draft));
    queryClient.setQueryData<{
      sales: SaleWorkspaceRecord[];
      preview: boolean;
    }>(["sale-workspace"], (previous) => ({
      preview: result.preview ?? previous?.preview ?? false,
      sales: [
        result.sale,
        ...(previous?.sales ?? []).filter((sale) => sale.id !== result.sale.id),
      ],
    }));
    if (result.document) setSelectedDocumentId(result.document.id);
    return result.sale;
  };
  const request = async (url: string, method: string, payload: object) => {
    const key = JSON.stringify({ url, method, payload });
    const requestId = retryIds.current.get(key) ?? saleRequestId();
    retryIds.current.set(key, requestId);
    try {
      const result = await customFetch<SaleWorkspaceMutation>(url, {
        method,
        body: JSON.stringify({ ...payload, requestId }),
      });
      retryIds.current.delete(key);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500)
        retryIds.current.delete(key);
      throw error;
    }
  };
  const saveInternal = async (): Promise<SaleWorkspaceRecord> => {
    if (!draft) throw new Error("Open a sale first.");
    if (record && !dirty) return record;
    // Old local payment entries are never promoted to received money. The server owns the ledger.
    const editable = {
      ...draft,
      payments: [],
      deposit: "",
    } as SaleWorkspaceDraft;
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
  };
  const run = async (operation: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true);
    setProblems([]);
    setActionProblem("");
    try {
      await operation();
    } catch (error) {
      const serverMessage =
        error instanceof ApiError &&
        error.data &&
        typeof error.data === "object" &&
        "error" in error.data
          ? String(error.data.error)
          : "";
      const text =
        error instanceof ApiError &&
        error.status === 409 &&
        /another device|changed on|reload.*sav|revision/i.test(serverMessage)
          ? "Another staff member changed this sale. Your edits are kept. Reload the latest sale before continuing."
          : serverMessage
            ? serverMessage
            : error instanceof Error
              ? error.message
              : "Could not save. Keep this page open and try again.";
      setProblems([text]);
      setActionProblem(text);
      setMessage(
        "Changes have not been confirmed. Please review the message above.",
      );
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  };
  const save = () =>
    void run(async () => {
      await saveInternal();
      setMessage("Sale saved. Available to staff on other devices.");
    });
  const command = async (
    path: string,
    payload: object,
    current?: SaleWorkspaceRecord,
  ) => {
    const saved = current ?? (await saveInternal());
    return accept(
      await request(`/api/sale-workspace/${saved.id}${path}`, "POST", {
        expectedRevision: saved.revision,
        ...payload,
      }),
    );
  };
  const createCustomerLink = () =>
    void run(async () => {
      const saved = await saveInternal();
      if (!linkRequest.current) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        linkRequest.current = {
          token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
            "",
          ),
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        };
      }
      const payload = {
        expectedRevision: saved.revision,
        days: 30,
        ...linkRequest.current,
      };
      const key = JSON.stringify(payload);
      const requestId = retryIds.current.get(key) ?? saleRequestId();
      retryIds.current.set(key, requestId);
      const result = await customFetch<
        SaleWorkspaceMutation & { customerUrl: string }
      >(`/api/sale-workspace/${saved.id}/customer-links`, {
        method: "POST",
        body: JSON.stringify({ ...payload, requestId }),
      });
      accept(result);
      retryIds.current.delete(key);
      linkRequest.current = null;
      setCustomerUrl(
        new URL(
          import.meta.env.BASE_URL.replace(/\/$/, "") + result.customerUrl,
          window.location.origin,
        ).href,
      );
      setMessage("Customer link created. Share it with this buyer.");
    });
  const emailCustomerLink = () =>
    void run(async () => {
      if (!customerUrl) return;
      const saved = await saveInternal();
      const token = new URL(customerUrl).pathname.split("/").pop();
      accept(
        await request(
          `/api/sale-workspace/${saved.id}/customer-links/email`,
          "POST",
          { expectedRevision: saved.revision, token },
        ),
      );
      setMessage("Customer link email status updated.");
    });
  const updateLifecycle = (status: "reserved" | "sold" | "released") =>
    void run(async () => {
      await command("/lifecycle", { status });
      await queryClient.invalidateQueries({ queryKey: getGetStockQueryKey() });
      setMessage(
        status === "released"
          ? "Reservation released. Stock availability updated."
          : `Vehicle marked ${status}. Stock availability updated.`,
      );
    });
  const emailDocument = () =>
    void run(async () => {
      if (!record || !selectedDocument) return;
      const saved = await saveInternal();
      const result = await request(
        `/api/sale-workspace/${saved.id}/documents/${selectedDocument.id}/email`,
        "POST",
        { expectedRevision: saved.revision },
      );
      accept(result);
      setMessage("Document email status updated.");
    });
  const downloadDocument = () =>
    void run(async () => {
      if (!record || !selectedDocument) return;
      const response = await customFetch<Blob>(
        `/api/sale-workspace/${record.id}/documents/${selectedDocument.id}/pdf`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = selectedDocument.number + ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  const showReceipt = (id: string) => {
    setSelectedDocumentId(id);
    changeTab(4);
  };
  const recordPayment = (payment: SaleWorkspacePaymentInput) =>
    void run(async () => {
      if (pendingConfirmation)
        await command(`/payments/${pendingConfirmation.id}/confirm`, {
          date: payment.date,
          reserveVehicle:
            pendingConfirmation.kind === "deposit" && !record?.completedAt,
        });
      else
        await command(
          payment.kind === "deposit" &&
            payment.status === "confirmed" &&
            !record?.completedAt
            ? "/take-deposit"
            : "/payments",
          { payment },
        );
      await queryClient.invalidateQueries({ queryKey: getGetStockQueryKey() });
      setPaymentDialog(false);
      setPendingConfirmation(undefined);
      setMessage(
        payment.status === "confirmed"
          ? payment.kind === "deposit"
            ? "Deposit received. Car reserved; receipt, agreement and balance statement are ready."
            : "Payment recorded. The receipt is ready to print."
          : "Pending payment saved. The balance is unchanged.",
      );
      if (payment.status === "confirmed") {
        changeTab(4);
        if (payment.kind === "final-payment") setCompleteDialog(true);
      }
      setPaymentIntent(undefined);
    });
  const issueDocument = (type: "invoice" | "statement") =>
    void run(async () => {
      await command("/documents", { type });
      changeTab(4);
      setMessage("Document saved. Reprints will keep these details.");
    });
  const latest = record && records.find((sale) => sale.id === record.id);
  const stale = Boolean(latest && record && latest.revision > record.revision);
  const reloadLatest = () =>
    void run(async () => {
      if (
        dirty &&
        !window.confirm(
          "Discard your unsaved edits and open the latest saved sale?",
        )
      )
        return;
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(
        `/api/sale-workspace/${record!.id}`,
      );
      accept({ sale: result.sale });
      setPaymentDialog(false);
      setPendingConfirmation(undefined);
      setReversePayment(null);
      setHandoverDialog(false);
      setMessage("Latest saved sale loaded.");
    });
  const changeTab = (index: number) => {
    setTab(index <= 2 ? 0 : index >= 4 ? 4 : 3);
    setProblems([]);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: embedded });
      if (embedded)
        heading.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
    });
  };
  const field = (key: keyof SaleDraft, label: string, type = "text") => (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <Input
        type={type}
        inputMode={key === "price" ? "decimal" : undefined}
        value={String(draft?.[key] ?? "")}
        onChange={(e) => update(key, e.target.value as never)}
        className="h-12 bg-white"
      />
    </label>
  );
  const visibleRecords = records.filter((item) => {
    const d = item.draft;
    const matches =
      `${d.customer} ${d.phone} ${d.email} ${d.vehicle} ${d.registration} ${item.reference}`
        .toLowerCase()
        .includes(saleSearch.toLowerCase());
    return (
      matches &&
      (saleFilter === "all" ||
        (saleFilter === "balance" && totals(d).balance > 0) ||
        (saleFilter === "completed" &&
          Boolean(item.completedAt || d.fulfilment?.completedAt)) ||
        (saleFilter === "delivery" &&
          d.fulfilment?.method === "delivery" &&
          Boolean(d.fulfilment.scheduledDate) &&
          !d.fulfilment.completedAt) ||
        (saleFilter === "collection" &&
          d.fulfilment?.method !== "delivery" &&
          d.preparation &&
          !d.fulfilment?.completedAt))
    );
  });
  const selected = stock?.cars.find((car) => car.id === draft?.vehicleId);
  const amount = draft ? totals(draft) : null;
  const print = async () => {
    if (!draft || preparingPrint) return;
    const found = selectedDocument || receiptStyle === "blank" ? [] : errors(draft, record?.draft);
    setProblems(found);
    if (!found.length) {
      printCleanup.current?.();
      const sheet = document
        .querySelector(".sales-document-workbench .sales-document")
        ?.cloneNode(true) as HTMLElement | undefined;
      if (!sheet) return;
      sheet.classList.add("sales-print-copy");
      sheet.querySelectorAll(".sales-chrome").forEach((node) => node.remove());
      document.body.appendChild(sheet);
      const originalTitle = document.title;
      const cleanup = () => {
        sheet.remove();
        document.title = originalTitle;
        window.removeEventListener("afterprint", cleanup);
        if (printCleanup.current === cleanup) printCleanup.current = null;
      };
      printCleanup.current = cleanup;
      setPreparingPrint(true);
      try {
        // Prepare the validated snapshot, so later form edits cannot change the document being printed.
        await Promise.race([
          Promise.allSettled([
            document.fonts?.ready,
            ...Array.from(sheet.querySelectorAll("img")).map((image) =>
              image.decode(),
            ),
          ]),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        if (!sheet.isConnected) return;
        sheet
          .querySelectorAll<HTMLImageElement>("img.invoice-logo")
          .forEach((image) => {
            if (image.naturalWidth) return;
            const fallback = document.createElement("span");
            fallback.className = "invoice-wordmark";
            fallback.textContent = selectedDocument
              ? selectedDocument.snapshot.branding.identity.logoText ||
                selectedDocument.snapshot.branding.identity.name
              : settings.identity.logoText || settings.identity.name;
            image.replaceWith(fallback);
          });
        document.title = receiptStyle === "blank" ? `${settings.identity.name} - Blank receipt stationery` : `${selectedDocument?.snapshot.branding.identity.name ?? settings.identity.name} - ${selectedDocument?.title ?? documentType} - ${selectedDocument?.number ?? draft.id}`;
        window.addEventListener("afterprint", cleanup, { once: true });
        window.print();
      } catch {
        cleanup();
        setProblems(["The print preview could not open. Please try again."]);
      } finally {
        setPreparingPrint(false);
      }
    }
  };
  return (
    <div
      className={`sales-workspace sales-premium-workspace flex flex-col ${embedded ? "sales-embedded-workspace" : "fixed inset-0 z-[70]"}`}
    >
      {(!embedded || draft) && (
        <header className="sales-chrome sales-titlebar">
          <div className="sales-titlebar-identity">
            <Button
              className="sales-back-button"
              variant="ghost"
              onClick={() => leave(!draft)}
            >
              <ArrowLeft size={17} />
              {draft ? "All sales" : "Staff portal"}
            </Button>
            <div className="sales-titlebar-name">
              <p>{draft ? draft.customer || "New sale" : "Sales workspace"}</p>
              <p>
                {draft
                  ? (record?.reference ?? "Unsaved sale")
                  : settings.identity.name}
              </p>
            </div>
          </div>
          <div className="sales-titlebar-actions">
            <span className="sales-draft-state" data-dirty={dirty}>
              {dirty
                ? "Unsaved changes"
                : draft
                  ? sales.some((sale) => sale.id === draft.id)
                    ? "Saved sale"
                    : "New sale"
                  : "Shared records"}
            </span>
            {draft && (
              <Button
                className="sales-primary-action"
                onClick={save}
                disabled={busy}
              >
                <Save size={16} />
                {busy ? "Saving…" : record?.completedAt ? "Save progress" : "Save draft"}
              </Button>
            )}
          </div>
        </header>
      )}
      {draft && (
        <div className="sales-chrome sales-quick-actions">
          <div>
            <span className="sales-status-tag">{salePaymentState(draft)}</span>
            <span>
              {draft.fulfilment?.completedAt
                ? draft.fulfilment.method === "delivery"
                  ? "Delivered"
                  : "Collected"
                : draft.fulfilment?.scheduledDate
                  ? draft.fulfilment.method === "delivery"
                    ? "Delivery booked"
                    : "Collection booked"
                  : "Handover not arranged"}
            </span>
          </div>
          <div>
            {record && (
              <HistoryLinks
                vehicleId={record.draft.vehicleId}
                recordType="sale"
                recordId={record.id}
                vehicle={Boolean(
                  record.draft.vehicleId || record.draft.vehicle,
                )}
              />
            )}
          </div>
        </div>
      )}
      {draft && (
        <dl className="sales-financial-summary sales-chrome">
          <div>
            <dt>Total due</dt>
            <dd>
              {money(amount!.price + amount!.adjustments - amount!.allowance)}
            </dd>
          </div>
          <div>
            <dt>Confirmed paid</dt>
            <dd>{money(amount!.deposit)}</dd>
          </div>
          <div>
            <dt>{amount!.balance < 0 ? "Customer credit" : "Outstanding"}</dt>
            <dd>{money(Math.abs(amount!.balance))}</dd>
          </div>
        </dl>
      )}
      {(stale ||
        problems.some((p) => p.startsWith("Another staff member"))) && (
        <div className="sales-conflict-banner" role="alert">
          <p>
            A newer version of this sale is available. Your unsaved edits are
            kept.
          </p>
          <Button variant="outline" disabled={busy} onClick={reloadLatest}>
            Reload latest sale
          </Button>
        </div>
      )}
      {!draft ? (
        <main className="sales-drafts-home">
          <div className="sales-drafts-intro">
            <div>
              <p className="sales-eyebrow">Sales workspace</p>
              <h1>Sales</h1>
              <p>Find a customer, reopen a sale or start a new one.</p>
            </div>
            {!embedded && (
              <Button
                className="sales-primary-action"
                onClick={() => open(emptyDraft())}
              >
                <Plus size={17} />
                New sale
              </Button>
            )}
          </div>
          <div className="sales-list-search">
            <label>
              Search sales
              <Input
                value={saleSearch}
                onChange={(e) => setSaleSearch(e.target.value)}
                placeholder="Customer, phone, registration or reference"
              />
            </label>
            <label>
              Show
              <select
                value={saleFilter}
                onChange={(e) => setSaleFilter(e.target.value)}
              >
                <option value="all">All sales</option>
                <option value="balance">Awaiting balance</option>
                <option value="delivery">Delivery booked</option>
                <option value="collection">Ready for collection</option>
                <option value="completed">Sale completed</option>
              </select>
            </label>
            <Button
              variant="outline"
              disabled={salesQuery.isFetching}
              onClick={() => void salesQuery.refetch()}
            >
              Refresh sales
            </Button>
          </div>
          {salesQuery.isLoading && <p role="status">Loading shared sales…</p>}
          {salesQuery.isError && (
            <div role="alert" className="sales-action-error">
              Shared sales could not be loaded. Please refresh before recording
              payments.
            </div>
          )}
          {sales.length ? (
            <section className="sales-draft-list" aria-label="Saved sales">
              <div className="sales-draft-list-heading">
                <h2>
                  Saved sales <span>{sales.length}</span>
                </h2>
                <p>Shared with dealership staff</p>
              </div>
              {visibleRecords.map((item) => {
                const sale = item.draft;
                return (
                  <button
                    key={sale.id}
                    onClick={() => open(sale, item)}
                    className="sales-draft-row"
                  >
                    <span className="sales-draft-customer">
                      {sale.customer || "Unnamed customer"}
                      <small>
                        {item.reference} · {sale.phone}
                      </small>
                    </span>
                    <span className="sales-draft-vehicle">
                      {sale.vehicle || "Vehicle not selected"}
                    </span>
                    <span className="sales-draft-amount">
                      {money(totals(sale).balance)}
                      <small>
                        {salePaymentState(sale)} ·{" "}
                        {sale.fulfilment?.completedAt
                          ? "Handed over"
                          : sale.fulfilment?.method === "delivery"
                            ? "Delivery"
                            : "Collection"}
                      </small>
                    </span>
                  </button>
                );
              })}
              {!visibleRecords.length && (
                <p className="sales-search-empty">
                  No sales match these filters.
                </p>
              )}
            </section>
          ) : (
            <div className="sales-empty-state">
              <div className="sales-empty-icon">
                <FileText size={28} />
              </div>
              <h2>Your first sale starts here</h2>
              <p>
                Choose a car and enter the customer. Record payments and issue
                their paperwork whenever they need it.
              </p>
              <div className="sales-empty-steps">
                <span>
                  <UserRound size={18} /> Customer details
                </span>
                <span>
                  <CarFront size={18} /> Vehicle &amp; agreed price
                </span>
                <span>
                  <FileText size={18} /> Receipts & documents
                </span>
              </div>
            </div>
          )}
          {olderDrafts.length > 0 && (
            <details className="sales-legacy-drafts">
              <summary>
                Older drafts on this device ({olderDrafts.length})
              </summary>
              <p>
                These were demonstration drafts. Opening one copies the customer
                and sale details only. Old payment entries are not confirmed or
                credited.
              </p>
              {olderDrafts.map((old) => (
                <Button
                  variant="outline"
                  key={old.id}
                  onClick={() =>
                    open({
                      ...old,
                      id: "DRAFT-" + saleRequestId(),
                      payments: [],
                      deposit: "",
                      handover: false,
                      fulfilment: undefined,
                    })
                  }
                >
                  Open older draft: {old.customer || old.id}
                </Button>
              ))}
            </details>
          )}
        </main>
      ) : (
        <>
          <nav
            ref={sectionNavigation}
            aria-label="Sale sections"
            className="sales-chrome sales-section-ribbon"
          >
            {[
              { label: "Deal details", index: 0, group: 0 },
              { label: "Payments", index: 3, group: 1 },
              { label: "Documents & handover", index: 4, group: 2 },
            ].map(({ label, index, group }) => {
              const Icon = sectionIcons[index];
              return (
                <button
                  key={label}
                  aria-current={
                    (tab <= 2 ? 0 : tab === 3 ? 1 : 2) === group
                      ? "step"
                      : undefined
                  }
                  onClick={() => changeTab(index)}
                  className="sales-section-tab"
                  disabled={busy}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sales-chrome sales-decision-bar">
            <div>
              <strong>
                {record?.completedAt
                  ? "Sale completed"
                  : record?.lifecycle?.status === "reserved"
                    ? "Reserved for this customer"
                    : "Sale in progress"}
              </strong>
              <span>
                {record?.documents.some((d) => d.type === "invoice")
                  ? "Invoice issued"
                  : "Invoice not issued"}{" "}
                ·{" "}
                {draft.fulfilment?.completedAt
                  ? "Handover recorded"
                  : "Handover pending"}
              </span>
            </div>
            <Button
              variant="outline"
              disabled={
                busy ||
                Boolean(record?.completedAt) ||
                !draft.customer ||
                !draft.vehicle ||
                !(Number(draft.price) > 0)
              }
              onClick={() => {
                setPaymentIntent("deposit");
                setPendingConfirmation(undefined);
                setActionProblem("");
                setPaymentDialog(true);
              }}
            >
              Deposit & receipt
            </Button>
            <Button
              disabled={
                busy ||
                Boolean(record?.completedAt) ||
                !draft.customer ||
                !draft.vehicle ||
                !(Number(draft.price) > 0)
              }
              onClick={() => {
                setActionProblem("");
                if (amount!.balance > 0) {
                  setPaymentIntent("final-payment");
                  setPendingConfirmation(undefined);
                  setPaymentDialog(true);
                } else setCompleteDialog(true);
              }}
            >
              Complete sale
            </Button>
            <Button variant="outline" onClick={() => changeTab(4)}>
              Receipts & documents
            </Button>
          </div>
          <main className="sales-workspace-content sales-premium-content" data-editor-view={editorView}>
            {tab !== 4 && <div className="sales-editor-view-switch" aria-label="Invoice workspace view">
              <button type="button" aria-pressed={editorView === "edit"} onClick={() => setEditorView("edit")}>Edit sale</button>
              <button type="button" aria-pressed={editorView === "preview"} onClick={() => setEditorView("preview")}>Invoice preview</button>
            </div>}
            <div className="sales-sheet-layout" data-document={tab === 4}>
              <fieldset disabled={busy} className="sales-active-sheet">
                <div className="sales-chrome sales-section-intro">
                  <p className="sales-eyebrow">
                    Step {tab <= 2 ? 1 : tab === 3 ? 2 : 3} of 3
                  </p>
                  <h1
                    ref={heading}
                    tabIndex={-1}
                    className="sales-section-title"
                  >
                    {tab <= 2
                      ? "Deal details"
                      : tab === 3
                        ? "Payments"
                        : "Documents & handover"}
                  </h1>
                  <p className="sales-section-description">
                    {
                      [
                        "Enter the customer once. Their details carry through to the paperwork.",
                        "Choose from current stock, then confirm the agreed selling price.",
                        "Record the allowance agreed for the customer’s car.",
                        "Record payments received and keep every receipt. Fees and discounts update the balance.",
                        "Issue an invoice or statement, or reopen an earlier receipt exactly as it was issued.",
                        "Arrange collection or delivery independently of the payments and any viewing.",
                      ][tab]
                    }
                  </p>
                </div>
                {problems.length > 0 && (
                  <ul
                    role="alert"
                    className="sales-chrome mb-5 list-inside list-disc border border-red-300 bg-red-50 p-4 text-sm text-red-800"
                  >
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {tab <= 2 && (
                  <div className="sales-form-panel sales-customer-panel">
                    <details className="sales-customer-import">
                      <summary>
                        <UserRound size={18} aria-hidden="true" />
                        Use a recent enquiry or reservation
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <Input
                        aria-label="Search recent customers"
                        placeholder="Search name, telephone or reference"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                      />
                      <p className="my-3 text-sm text-muted-foreground">
                        Selecting a customer links their enquiry or reservation
                        and vehicle. Payments are recorded separately.
                      </p>
                      {(enquiries.isLoading || reservations.isLoading) && (
                        <p role="status">Loading recent customers…</p>
                      )}
                      {(enquiries.isError || reservations.isError) && (
                        <p role="alert">
                          Some recent records could not be loaded. You can enter
                          details below.
                        </p>
                      )}
                      <div className="sales-recent-customers max-h-64 overflow-auto divide-y">
                        {recentCustomers.map((item) => (
                          <button
                            key={item.id}
                            className="block w-full py-3 text-left hover:bg-secondary"
                            onClick={() => {
                              setDraft({
                                ...draft,
                                customer: item.name,
                                email: item.email,
                                phone: item.phone,
                                customerSource: item.id,
                                sourceEnquiryId: item.sourceEnquiryId,
                                sourceReservationId: item.sourceReservationId,
                                vehicleId: item.vehicleId,
                                vehicle: item.vehicle,
                                registration: item.registration,
                                price: item.price,
                              });
                              setMessage(
                                "Customer details copied. Please check them below.",
                              );
                            }}
                          >
                            <strong>{item.name}</strong>
                            <span className="block text-sm text-muted-foreground">
                              {item.id} ·{" "}
                              {new Date(item.date).toLocaleDateString("en-GB")}
                            </span>
                          </button>
                        ))}
                        {!recentCustomers.length &&
                          !enquiries.isLoading &&
                          !reservations.isLoading && (
                            <p className="py-4 text-sm">
                              No matching recent customers.
                            </p>
                          )}
                      </div>
                    </details>
                    {draft.customerSource && (
                      <p className="mb-4 text-sm text-muted-foreground">
                        Copied from {draft.customerSource}
                      </p>
                    )}
                    <div className="sales-panel-heading">
                      <h2>Contact details</h2>
                      <p>These details appear on the sales paperwork.</p>
                    </div>
                    <div className="sales-field-grid">
                      {field("customer", "Customer name")}
                      {field("phone", "Telephone", "tel")}
                      {field("email", "Email", "email")}
                    </div>
                    <label className="mt-6 grid gap-2 text-sm font-medium">
                      Address
                      <Textarea
                        rows={3}
                        value={draft.address}
                        onChange={(e) => update("address", e.target.value)}
                      />
                    </label>
                  </div>
                )}
                {tab <= 2 && (
                  <div className="sales-form-panel">
                    <div className="sales-panel-heading">
                      <h2>Vehicle &amp; selling price</h2>
                      <p>
                        Select the car, then record the price agreed with the
                        customer.
                      </p>
                    </div>
                    <label className="grid gap-2 text-sm font-medium">
                      Vehicle
                      <select
                        aria-label="Vehicle"
                        className="h-12 w-full border border-input bg-white px-3"
                        value={draft.vehicleId}
                        onChange={(e) => {
                          const car = stock?.cars.find(
                            (c) => c.id === e.target.value,
                          );
                          if (car)
                            setDraft({
                              ...draft,
                              vehicleId: car.id,
                              vehicle: vehicleDisplayTitle(car),
                              registration: vehicleRegistration(car),
                              price: String(car.price || ""),
                            });
                        }}
                      >
                        <option value="">Choose a car</option>
                        {draft.vehicleId && !selected && (
                          <option value={draft.vehicleId}>
                            {draft.vehicle} · Saved on this sale
                          </option>
                        )}
                        {stock?.cars.map((car) => (
                          <option key={car.id} value={car.id}>
                            {vehicleDisplayTitle(car)} ·{" "}
                            {vehicleRegistrationLabel(car)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.vehicleId && !selected && (
                      <p className="sales-panel-note">
                        The vehicle is saved on this sale and is no longer in
                        the current stock list. You can continue recording
                        payments and arranging handover.
                      </p>
                    )}
                    {selected && (
                      <div className="sales-selected-vehicle">
                        <img
                          src={getThumbnailUrl(selected)}
                          alt={draft.vehicle}
                          className="sales-selected-vehicle-photo"
                        />
                        <div>
                          <p className="sales-eyebrow">Selected vehicle</p>
                          <h3>{draft.vehicle}</h3>
                          <p>{vehicleRegistrationLabel(selected)}</p>
                        </div>
                      </div>
                    )}
                    <div className="sales-field-grid mt-6">
                      {field("registration", "Vehicle registration")}
                      {field("price", "Agreed vehicle price (£)")}
                    </div>
                  </div>
                )}
                {tab <= 2 && (
                  <details className="sales-optional-panel">
                    <summary>Part exchange (optional)</summary>
                    <div className="sales-form-panel sales-exchange-panel">
                      <div className="sales-panel-heading">
                        <h2>Part-exchange cars</h2>
                        <p>
                          Record up to three cars and the allowance agreed for
                          each.
                        </p>
                      </div>
                      {!exchanges(draft).length && (
                        <div className="sales-entry-empty">
                          <ArrowLeftRight size={23} aria-hidden="true" />
                          <div>
                            <h3>No part-exchange cars</h3>
                            <p>
                              Add a car if a part exchange is included in this
                              sale.
                            </p>
                          </div>
                        </div>
                      )}
                      {exchanges(draft).map((row, index) => (
                        <fieldset key={index} className="sales-entry-group">
                          <legend className="mb-4 font-semibold">
                            Part exchange {index + 1}
                          </legend>
                          <div className="sales-exchange-fields">
                            {(
                              [
                                ["registration", "Registration"],
                                ["description", "Make and model"],
                                ["value", "Allowance (£)"],
                              ] as const
                            ).map(([key, label]) => (
                              <label key={key} className="grid gap-2 text-sm">
                                {label}
                                <Input
                                  aria-label={`${label} ${index + 1}`}
                                  inputMode={
                                    key === "value" ? "decimal" : undefined
                                  }
                                  value={row[key]}
                                  onChange={(e) =>
                                    update(
                                      "exchanges",
                                      exchanges(draft).map((r, i) =>
                                        i === index
                                          ? { ...r, [key]: e.target.value }
                                          : r,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            ))}
                          </div>
                          <Button
                            className="sales-remove-entry mt-3"
                            variant="ghost"
                            onClick={() =>
                              update(
                                "exchanges",
                                exchanges(draft).filter((_, i) => i !== index),
                              )
                            }
                          >
                            Remove part exchange {index + 1}
                          </Button>
                        </fieldset>
                      ))}
                      <Button
                        className="sales-add-entry"
                        variant="outline"
                        disabled={exchanges(draft).length >= 3}
                        onClick={() =>
                          update("exchanges", [
                            ...exchanges(draft),
                            { registration: "", description: "", value: "" },
                          ])
                        }
                      >
                        <Plus size={16} />
                        Add part-exchange car
                      </Button>
                      <p className="sales-panel-note">
                        Up to three cars. Total allowance:{" "}
                        {money(amount!.allowance)}
                      </p>
                    </div>
                  </details>
                )}
                {tab <= 2 && <details className="sales-optional-panel">
                  <summary>Agreed invoice notes (optional)</summary>
                  <label className="grid gap-2 text-sm font-medium mt-4">
                    Agreed invoice notes
                    <Textarea rows={3} value={draft.notes} onChange={e => update("notes", e.target.value)} placeholder="Only include details agreed with the customer" />
                  </label>
                  <p className="sales-panel-note">Shown on the draft and future issued documents. Existing copies stay unchanged.</p>
                </details>}
                {tab === 3 && (
                  <div className="sales-form-panel sales-payments-panel">
                    <section className="sales-payment-section">
                      <div className="sales-panel-heading">
                        <h2>Fees and discounts</h2>
                        <p>
                          Add agreed charges or deductions to the vehicle price.
                        </p>
                      </div>
                      {(draft.adjustments ?? []).map((row, index) => (
                        <fieldset
                          key={index}
                          className="sales-entry-group sales-field-grid"
                        >
                          <legend className="mb-2 font-medium">
                            Adjustment {index + 1}
                          </legend>
                          <label>
                            Type
                            <select
                              className="block h-12 w-full border bg-white px-3"
                              value={row.kind}
                              onChange={(e) =>
                                update(
                                  "adjustments",
                                  draft.adjustments!.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          kind: e.target.value as
                                            "fee" | "discount",
                                        }
                                      : r,
                                  ),
                                )
                              }
                            >
                              <option value="fee">Add fee</option>
                              <option value="discount">
                                Subtract discount
                              </option>
                            </select>
                          </label>
                          {(
                            [
                              ["description", "Description"],
                              ["amount", "Amount (£)"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <Input
                                aria-label={`${label} adjustment ${index + 1}`}
                                inputMode={
                                  key === "amount" ? "decimal" : undefined
                                }
                                value={row[key]}
                                onChange={(e) =>
                                  update(
                                    "adjustments",
                                    draft.adjustments!.map((r, i) =>
                                      i === index
                                        ? { ...r, [key]: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                              />
                            </label>
                          ))}
                          <Button
                            className="sales-remove-entry"
                            variant="ghost"
                            onClick={() =>
                              update(
                                "adjustments",
                                draft.adjustments!.filter(
                                  (_, i) => i !== index,
                                ),
                              )
                            }
                          >
                            Remove adjustment {index + 1}
                          </Button>
                        </fieldset>
                      ))}
                      <Button
                        className="sales-add-entry"
                        variant="outline"
                        onClick={() =>
                          update("adjustments", [
                            ...(draft.adjustments ?? []),
                            { description: "", amount: "", kind: "fee" },
                          ])
                        }
                      >
                        <Plus size={16} />
                        Add fee or discount
                      </Button>
                    </section>
                    <PaymentLedger
                      entries={record?.payments ?? []}
                      documents={record?.documents ?? []}
                      busy={busy}
                      onRecord={() => {
                        setPendingConfirmation(undefined);
                        setActionProblem("");
                        setPaymentDialog(true);
                      }}
                      onDocument={showReceipt}
                      onConfirm={(payment) => {
                        setPendingConfirmation(payment);
                        setActionProblem("");
                        setPaymentDialog(true);
                      }}
                      onReverse={(payment) => {
                        setActionProblem("");
                        setReversePayment(payment);
                      }}
                    />
                    <p className="sales-payment-notice">
                      Record money already received; this does not charge a card.
                      A confirmed deposit reserves the car and issues its receipt
                      and agreement. Other payments update the balance.
                    </p>
                  </div>
                )}
                {tab === 4 && (
                  <>
                    {record?.documents.some(doc => doc.type === "invoice") && <p className="sales-panel-note">To correct an invoice, edit the sale details and issue a new version. Earlier issued copies remain available below.</p>}
                    <div className="sales-chrome sales-document-toolbar">
                      <div className="sales-document-issue-actions">
                        <Button variant="outline" onClick={() => { setEditorView("edit"); changeTab(0); }}>Edit sale details</Button>
                        <Button
                          variant="outline"
                          onClick={() => issueDocument("invoice")}
                        >
                          Issue sales invoice
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => issueDocument("statement")}
                        >
                          Create balance statement
                        </Button>
                      </div>
                      <Button
                        className="sales-primary-action"
                        onClick={print}
                        disabled={preparingPrint}
                      >
                        <Printer size={16} />
                        {preparingPrint
                          ? "Preparing print…"
                          : "Print / Save PDF"}
                      </Button>
                    </div>
                    <div className="sales-document-selector sales-chrome">
                      <label>
                        Document
                        <select
                          aria-label="Document"
                          value={selectedDocumentId ?? "preview"}
                          onChange={(e) =>
                            setSelectedDocumentId(
                              e.target.value === "preview"
                                ? null
                                : e.target.value,
                            )
                          }
                        >
                          <option value="preview">
                            Draft invoice preview — not issued
                          </option>
                          {[...(record?.documents ?? [])]
                            .reverse()
                            .map((doc) => (
                              <option key={doc.id} value={doc.id}>
                                {doc.title} · {doc.number}
                              </option>
                            ))}
                        </select>
                      </label>
                      {selectedDocument && (
                        <p>
                          Issued{" "}
                          {new Date(
                            selectedDocument.issuedAt,
                          ).toLocaleDateString("en-GB", {
                            timeZone: "Europe/London",
                          })}{" "}
                          by {saleStaffLabel(selectedDocument.issuedBy)}. This
                          saved copy stays unchanged.
                        </p>
                      )}
                    </div>
                    {record?.packDocumentIds?.length ? (
                      <div className="sales-chrome sales-pack-actions">
                        <Button
                          onClick={() => {
                            const pages = document.querySelectorAll(
                              ".sales-pack-source .sales-document",
                            );
                            if (!pages.length) return;
                            printCleanup.current?.();
                            const clones = Array.from(pages).map((page) => {
                              const clone = page.cloneNode(true) as HTMLElement;
                              clone.classList.add("sales-print-copy");
                              document.body.appendChild(clone);
                              return clone;
                            });
                            const cleanup = () => {
                              clones.forEach((c) => c.remove());
                              window.removeEventListener("afterprint", cleanup);
                            };
                            printCleanup.current = cleanup;
                            window.addEventListener("afterprint", cleanup, {
                              once: true,
                            });
                            window.print();
                          }}
                        >
                          Print full document pack
                        </Button>
                        <p>
                          Includes the issued invoice or reservation agreement,
                          receipts and supporting paperwork.
                        </p>
                      </div>
                    ) : null}
                    <div className="sales-pack-source" hidden>
                      {record?.packDocumentIds
                        ?.map((id) => record.documents.find((d) => d.id === id))
                        .filter((d): d is SaleWorkspaceDocument => Boolean(d))
                        .map((d) => (
                          <SalesDocument key={d.id} issuedDocument={d} />
                        ))}
                    </div>
                    <div className="sales-chrome sales-document-selector">
                      <label>Print style<select aria-label="Receipt print style" value={receiptStyle === 'classic' && selectedDocument?.type !== 'receipt' ? 'modern' : receiptStyle} onChange={e => setReceiptStyle(e.target.value as typeof receiptStyle)}>
                        <option value="modern">Modern document</option>
                        {selectedDocument?.type === 'receipt' && <option value="classic">Classic receipt book</option>}
                        <option value="blank">Blank receipt - fill in by hand</option>
                      </select></label>
                      <p>Classic uses the selected saved receipt. Blank stationery does not issue a receipt. Download/email and the full document pack keep the saved standard documents.</p>
                    </div>
                    <div className="sales-document-workbench">
                      {receiptStyle === "blank" ? (
                        <ClassicReceipt blank branding={invoiceBranding(settings, paperworkQuery.data?.invoiceSettings)} />
                      ) : selectedDocument ? (
                        receiptStyle === "classic" && selectedDocument.type === "receipt" ? <ClassicReceipt document={selectedDocument} branding={selectedDocument.snapshot.branding} /> : <SalesDocument issuedDocument={selectedDocument} />
                      ) : (
                        <SalesDocument
                          draft={draft}
                          dealer={invoiceBranding(settings, paperworkQuery.data?.invoiceSettings) as typeof settings}
                          vehicle={selected}
                          documentType={documentType}
                        />
                      )}
                      <aside className="sales-chrome sales-document-controls">
                        <div className="sales-panel-heading">
                          <h2>Receipts & documents</h2>
                          <p>
                            Every issued document remains available, including
                            earlier versions.
                          </p>
                        </div>
                        <div className="sales-saved-documents">
                          {[...(record?.documents ?? [])]
                            .reverse()
                            .map((doc) => (
                              <button
                                key={doc.id}
                                onClick={() => setSelectedDocumentId(doc.id)}
                                aria-pressed={selectedDocumentId === doc.id}
                              >
                                <FileText size={18} />
                                <span>
                                  <strong>{doc.title}</strong>
                                  <small>
                                    {doc.number} ·{" "}
                                    {new Date(doc.issuedAt).toLocaleDateString(
                                      "en-GB",
                                    )}
                                  </small>
                                </span>
                              </button>
                            ))}
                          {!record?.documents.length && (
                            <p>
                              No documents issued yet. Confirm a payment for its
                              receipt, or issue a sales invoice.
                            </p>
                          )}
                        </div>
                        <DocumentDelivery
                          record={record}
                          document={selectedDocument}
                          busy={busy}
                          onEmail={emailDocument}
                          onDownload={downloadDocument}
                        />
                        <label className="grid gap-2 text-sm font-medium mt-6">
                          Document notes
                          <Textarea
                            rows={4}
                            value={draft.notes}
                            onChange={(e) => update("notes", e.target.value)}
                            placeholder="Agreed details for future documents"
                          />
                        </label>
                        <p className="sales-panel-note">
                          Changes to notes appear on future documents. Saved
                          documents stay unchanged.
                        </p>
                      </aside>
                    </div>
                  </>
                )}
                {tab >= 4 && (
                  <>
                    <details className="sales-optional-panel">
                      <summary>
                        Customer links, history & reservation controls
                      </summary>
                      <SalesConnections
                        record={record}
                        busy={busy}
                        customerUrl={customerUrl}
                        onLink={createCustomerLink}
                        onEmailLink={emailCustomerLink}
                        onRevoke={() =>
                          void run(async () => {
                            await command("/customer-links/revoke", {});
                            setCustomerUrl("");
                            setMessage("Customer access revoked.");
                          })
                        }
                        onLifecycle={updateLifecycle}
                      />
                    </details>
                    <DeliveryPanel
                      saleCompleted={Boolean(
                        record?.completedAt ||
                        record?.lifecycle?.status === "sold",
                      )}
                      draft={draft}
                      busy={busy}
                      onChange={(value) => update("fulfilment", value)}
                      onReview={update}
                      onComplete={() => {
                        setActionProblem("");
                        setHandoverDialog(true);
                      }}
                    />
                    {record && (
                      <details className="sales-activity-history">
                        <summary>Sale history ({record.events.length})</summary>
                        <ol>
                          {[...record.events].reverse().map((event) => (
                            <li key={event.id}>
                              <strong>{event.description}</strong>
                              <span>
                                {new Date(event.occurredAt).toLocaleString(
                                  "en-GB",
                                  { timeZone: "Europe/London" },
                                )}{" "}
                                · {saleStaffLabel(event.actor)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </>
                )}
              </fieldset>
              {tab !== 4 && (
                <aside
                  className="sales-chrome sales-deal-overview"
                  aria-label="Sale overview"
                  data-expanded={showBreakdown || tab === 3}
                >
                  <div className="sales-overview-heading">
                    <h2>Live invoice</h2>
                    <span>{record ? "Saved sale" : "Unsaved"}</span>
                  </div>
                  <p className="sales-live-preview-help">Changes appear here as you type. This draft does not change issued documents.</p>
                  <div className="sales-live-paper">
                    <SalesDocument draft={draft} dealer={invoiceBranding(settings, paperworkQuery.data?.invoiceSettings) as typeof settings} vehicle={selected} documentType={documentType} />
                  </div>
                  <p className="sales-overview-note">
                    {dirty
                      ? "Unsaved changes shown. Save before recording payments or issuing documents."
                      : "Confirmed payments are deducted. Pending payments do not reduce the balance."}
                  </p>
                </aside>
              )}
            </div>
          </main>
          <footer className="sales-chrome sales-workspace-footer">
            <p role="status">
              {message ||
                (dirty
                  ? "Unsaved changes"
                  : "Shared sale file · Receipts remain available")}
            </p>
            <div className="sales-footer-actions">
              <Button
                variant="outline"
                disabled={tab <= 2}
                onClick={() => changeTab(tab === 3 ? 0 : 3)}
              >
                Previous
              </Button>
              {tab < 4 ? (
                <Button
                  className="sales-primary-action"
                  onClick={() => changeTab(tab <= 2 ? 3 : 4)}
                >
                  {tab <= 2 ? "Payments & adjustments" : "Receipts & documents"}
                  <ArrowRight size={16} />
                </Button>
              ) : (
                <Button
                  className="sales-primary-action"
                  onClick={() =>
                    record?.completedAt ? save() : setCompleteDialog(true)
                  }
                  disabled={busy}
                >
                  {busy
                    ? "Working…"
                    : record?.completedAt
                      ? "Save progress"
                      : "Complete sale"}
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
      {completeDialog && draft && (
        <CompleteSaleDialog
          draft={draft}
          total={amount!.price + amount!.adjustments - amount!.allowance}
          balance={amount!.balance}
          terms={paperworkQuery.data?.saleTerms ?? ""}
          busy={busy}
          problem={actionProblem}
          onClose={() => setCompleteDialog(false)}
          onComplete={() =>
            void run(async () => {
              await command("/complete-sale", { acknowledge: true });
              setCompleteDialog(false);
              await queryClient.invalidateQueries({
                queryKey: getGetStockQueryKey(),
              });
              changeTab(4);
              setMessage(
                "Sale completed. Invoice and document pack issued; car removed from public stock.",
              );
            })
          }
        />
      )}
      {paymentDialog && draft && (
        <PaymentDialog
          initialKind={paymentIntent}
          balance={amount!.balance}
          hasPayments={Boolean(
            record?.payments.some(
              (p) => p.status === "confirmed" && p.signedAmountPence > 0,
            ),
          )}
          busy={busy}
          problem={actionProblem}
          pending={pendingConfirmation}
          onClose={() => {
            setPaymentDialog(false);
            setPaymentIntent(undefined);
            setPendingConfirmation(undefined);
          }}
          onSave={recordPayment}
        />
      )}
      {reversePayment && record && (
        <ReversePaymentDialog
          payment={reversePayment}
          availablePence={
            reversePayment.amountPence +
            record.payments
              .filter((p) => p.reversesPaymentId === reversePayment.id)
              .reduce((sum, p) => sum + p.signedAmountPence, 0)
          }
          busy={busy}
          problem={actionProblem}
          onClose={() => setReversePayment(null)}
          onSave={(input) =>
            void run(async () => {
              await command(`/payments/${reversePayment.id}/reverse`, input);
              setReversePayment(null);
              setMessage(
                "Payment adjustment recorded. Original receipts remain unchanged.",
              );
              changeTab(4);
            })
          }
        />
      )}
      {handoverDialog && draft && (
        <HandoverDialog
          draft={draft}
          balance={amount!.balance}
          busy={busy}
          problem={actionProblem}
          onClose={() => setHandoverDialog(false)}
          onSave={(recipient, acknowledgeOutstanding) =>
            void run(async () => {
              await command("/handover", { recipient, acknowledgeOutstanding });
              setHandoverDialog(false);
              await queryClient.invalidateQueries({
                queryKey: getGetStockQueryKey(),
              });
              setMessage("Handover recorded. Confirmation is ready to print.");
              changeTab(4);
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
