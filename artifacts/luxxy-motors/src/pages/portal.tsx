import { useEffect, useState } from 'react';
import {
  getGetSalesQueryKey,
  getGetSaleFinalChecksQueryKey,
  getGetSaleChecklistQueryKey,
  getGetSaleQueryKey,
  getGetCustomerIntakeSessionQueryKey,
  getGetEnquiriesQueryKey,
  type Sale,
  type SaleInput,
  useCompleteSale,
  useCreateCustomerIntakeSession,
  useCreateSale,
  useGetCustomerIntakeSession,
  useGetEnquiries,
  useGetSale,
  useGetSaleFinalChecks,
  useGetSaleChecklist,
  useGetSales,
  usePrepareSale,
  useRevokeSaleSigning,
  useUpdateEnquiryStatus,
  useUpdateSaleChecklistItem,
  type Enquiry,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import {
  CheckCircle2,
  ClipboardCheck,
  CircleAlert,
  Clock3,
  Copy,
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Inbox,
  Link2,
  LoaderCircle,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  QrCode,
  ShieldAlert,
  UserRound,
  XCircle,
} from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStock } from '@/lib/stock-context';
import { formatPrice } from '@/lib/utils';
import { DealerSettingsPanel } from '@/components/dealer-settings-panel';

const statusLabels: Record<Enquiry['status'], string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

const typeLabels: Record<Enquiry['type'], string> = {
  viewing: 'Viewing',
  general: 'General',
  delivery: 'Delivery',
  warranty: 'Warranty',
  part_exchange: 'Part exchange',
};

function statusVariant(status: Enquiry['status']): 'default' | 'secondary' | 'outline' {
  if (status === 'new') return 'default';
  if (status === 'contacted') return 'secondary';
  return 'outline';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function deliveryLabel(status: string) {
  if (status === 'sent') return 'Sent';
  if (status === 'failed') return 'Failed';
  if (status === 'sending') return 'Sending';
  if (status === 'not_sent') return 'Not sent';
  return 'Pending';
}

type SaleView = Sale & {
  vehicle?: {
    id: string;
    title: string | null;
    registration: string | null;
    price: number | null;
    inventoryStatus: string;
    sourceStatus: string;
  } | null;
  customer?: { id: string; name: string; email: string | null; phone: string | null } | null;
  latestRevision?: {
    id: string;
    revisionNumber: number;
    status: string;
    packHash: string;
    documents?: Array<{ title: string; contentHash: string; required: boolean }>;
  } | null;
  signingSession?: {
    id: string;
    status: string;
    expiresAt: string;
    signedAt: string | null;
    signatureName: string | null;
  } | null;
  invoice?: { invoiceNumber: string; status: string; totalPence: number; balancePence: number } | null;
};

type SaleCheck = { code: string; label: string; passed: boolean; message: string };
type ChecklistItem = {
  code: string;
  label: string;
  description: string;
  status: 'pending' | 'complete' | 'not_applicable' | 'invalidated';
  required: boolean;
  eligible: boolean;
  canMarkNotApplicable: boolean;
  message: string;
  completedAt: string | null;
  completedBy: string | null;
};
type SaleChecklistView = {
  saleId: string;
  completedCount: number;
  totalCount: number;
  readyForPreparation: boolean;
  readyForCompletion: boolean;
  items: ChecklistItem[];
};

function saleView(value: Sale | undefined): SaleView | undefined {
  return value as SaleView | undefined;
}

function apiMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return fallback;
}

function DealChecklist({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const checklistQuery = useGetSaleChecklist(id, {
    query: {
      queryKey: getGetSaleChecklistQueryKey(id),
      refetchInterval: 5000,
    },
  });
  const updateItem = useUpdateSaleChecklistItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSaleChecklistQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetSaleQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetSaleFinalChecksQueryKey(id) });
      },
    },
  });
  const checklist = checklistQuery.data as unknown as SaleChecklistView | undefined;
  const completedCount = checklist?.completedCount ?? 0;
  const totalCount = checklist?.totalCount ?? 10;
  const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  const update = (code: string, status: 'complete' | 'not_applicable' | 'pending') => {
    updateItem.mutate({ id, code: code as never, data: { status } });
  };

  return (
    <div className="mt-7 rounded-2xl border border-primary/20 bg-primary/[0.03] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Auditable workflow</p>
          <h3 className="mt-2 flex items-center gap-2 text-xl font-black"><ClipboardCheck className="h-5 w-5 text-primary" /> Sales readiness checklist</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Confirm each deal fact against the current records. If a price, customer, vehicle or document revision changes, the relevant confirmation returns to review.
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-2xl font-black text-primary">{completedCount}/{totalCount}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Current items</p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-primary/10">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      {checklistQuery.isLoading ? (
        <p className="mt-5 flex items-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 h-4 w-4 animate-spin text-primary" /> Loading checklist…</p>
      ) : checklistQuery.isError ? (
        <p className="mt-5 text-sm text-destructive">The checklist could not be loaded. Refresh and try again.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {(checklist?.items ?? []).map((item) => {
            const confirmed = item.status === 'complete' || item.status === 'not_applicable';
            const invalidated = item.status === 'invalidated';
            return (
              <div key={item.code} className={`rounded-xl border p-4 ${confirmed ? 'border-green-200 bg-green-50/70' : invalidated ? 'border-amber-300 bg-amber-50' : 'bg-card'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className={`flex items-center gap-2 text-sm font-bold ${confirmed ? 'text-green-900' : invalidated ? 'text-amber-950' : 'text-foreground'}`}>
                      {confirmed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" /> : invalidated ? <CircleAlert className="h-4 w-4 shrink-0 text-amber-700" /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />}
                      {item.label}
                      {item.status === 'not_applicable' && <Badge variant="outline" className="ml-1 text-[10px]">Not applicable</Badge>}
                    </p>
                    <p className={`mt-1 text-xs ${confirmed ? 'text-green-900/75' : invalidated ? 'text-amber-900/80' : 'text-muted-foreground'}`}>{item.message}</p>
                    {confirmed && item.completedAt && <p className="mt-1 text-[11px] text-muted-foreground">Confirmed {formatDate(item.completedAt)} · {item.completedBy || 'staff'}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!confirmed && item.eligible && (
                      <Button type="button" size="sm" onClick={() => update(item.code, 'complete')} disabled={updateItem.isPending}>
                        Confirm
                      </Button>
                    )}
                    {!confirmed && item.canMarkNotApplicable && item.eligible && (
                      <Button type="button" size="sm" variant="outline" onClick={() => update(item.code, 'not_applicable')} disabled={updateItem.isPending}>
                        Not applicable
                      </Button>
                    )}
                    {confirmed && item.code !== 'documents_generated' && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => update(item.code, 'pending')} disabled={updateItem.isPending}>
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {updateItem.isError && <p className="mt-4 text-sm text-destructive">{apiMessage(updateItem.error, 'That checklist item could not be updated.')}</p>}
      {checklist && !checklist.readyForPreparation && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">Complete the pre-signature items above before preparing the document pack.</p>
      )}
      {checklist?.readyForPreparation && !checklist.readyForCompletion && (
        <p className="mt-4 rounded-lg bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">Pre-signature checks are complete. Prepare the document pack to create the final document item.</p>
      )}
    </div>
  );
}

function formatPence(value: number | undefined) {
  return formatPrice((value ?? 0) / 100, 'GBP');
}

function SaleCreateForm({
  onCreated,
  recentEnquiries,
}: {
  onCreated: (saleId: string) => void;
  recentEnquiries: Enquiry[];
}) {
  const { stock } = useStock();
  const createSale = useCreateSale();
  const createIntake = useCreateCustomerIntakeSession();
  const cars = stock?.cars ?? [];
  const [vehicleId, setVehicleId] = useState(cars[0]?.id ?? '');
  const [customerMode, setCustomerMode] = useState<'none' | 'enquiry' | 'qr'>('none');
  const [enquiryId, setEnquiryId] = useState('');
  const [intakeToken, setIntakeToken] = useState('');
  const [intakePath, setIntakePath] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('0');
  const [disclosures, setDisclosures] = useState('Development disclosure placeholder — requires legal review before production use.');
  const [fulfilmentMethod, setFulfilmentMethod] = useState<'collection' | 'delivery'>('collection');
  const selectedCar = cars.find((car) => car.id === vehicleId);
  const selectedEnquiry = recentEnquiries.find((enquiry) => enquiry.id === enquiryId);
  const intakeQuery = useGetCustomerIntakeSession(intakeToken, {
    query: {
      queryKey: getGetCustomerIntakeSessionQueryKey(intakeToken),
      enabled: Boolean(intakeToken),
      retry: false,
      refetchInterval: 2500,
    },
  });
  const intakeCustomer = intakeQuery.data?.customer;
  const selectedCustomer = customerMode === 'enquiry' && selectedEnquiry
    ? { id: null, name: selectedEnquiry.customerName, email: selectedEnquiry.email, phone: selectedEnquiry.phone }
    : customerMode === 'qr' && intakeCustomer
      ? intakeCustomer
      : null;
  const customerDetailsUrl = intakePath
    ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${intakePath}`
    : '';

  useEffect(() => {
    if (!intakeCustomer || intakeQuery.data?.status !== 'completed') return;
    setCustomerMode('qr');
    setName(intakeCustomer.name);
    setEmail(intakeCustomer.email ?? '');
    setPhone(intakeCustomer.phone ?? '');
  }, [intakeCustomer, intakeQuery.data?.status]);

  const resetCustomer = () => {
    setCustomerMode('none');
    setEnquiryId('');
    setIntakeToken('');
    setIntakePath('');
    setName('');
    setEmail('');
    setPhone('');
  };

  const chooseEnquiry = (value: string) => {
    setIntakeToken('');
    setIntakePath('');
    setEnquiryId(value);
    const enquiry = recentEnquiries.find((candidate) => candidate.id === value);
    if (!enquiry) {
      setCustomerMode('none');
      setName('');
      setEmail('');
      setPhone('');
      return;
    }
    setCustomerMode('enquiry');
    setName(enquiry.customerName);
    setEmail(enquiry.email ?? '');
    setPhone(enquiry.phone ?? '');
  };

  const generateCustomerLink = () => {
    if (!vehicleId) return;
    createIntake.mutate(
      { data: { vehicleId } },
      {
        onSuccess: (session) => {
          const token = session.customerDetailsPath.split('/').filter(Boolean).pop() ?? '';
          setCustomerMode('qr');
          setEnquiryId('');
          setIntakeToken(token);
          setIntakePath(session.customerDetailsPath);
          setName('');
          setEmail('');
          setPhone('');
        },
      },
    );
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCustomer) return;
    const data: SaleInput = {
      vehicleId,
      ...(selectedCustomer.id
        ? { customerId: selectedCustomer.id }
        : {
            customer: {
              name: name.trim(),
              email: email.trim() || null,
              phone: phone.trim() || null,
            },
          }),
      ...(customerMode === 'enquiry' && enquiryId ? { enquiryId } : {}),
      agreedPricePence: Math.round(Number(price) * 100),
      depositPence: Math.round(Number(deposit || 0) * 100),
      mileageAtSale: selectedCar?.mileage ?? null,
      disclosureNotes: disclosures.trim() || null,
      internalNotes: null,
      adjustments: [],
      partExchange: null,
      warranty: null,
      fulfilment: {
        method: fulfilmentMethod,
        targetDate: null,
        address: null,
        notes: null,
      },
    };
    createSale.mutate(
      { data },
      {
        onSuccess: (sale) => {
          onCreated(sale.id);
          setName('');
          setEmail('');
          setPhone('');
          setCustomerMode('none');
          setEnquiryId('');
          setIntakeToken('');
          setIntakePath('');
          setPrice('');
          setDeposit('0');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-primary/20 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">New development sale</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">Start a deal</h2>
        </div>
        <Badge variant="outline">Demo only</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold sm:col-span-2">
          <span>Vehicle</span>
          <select
            required
            value={vehicleId}
            onChange={(event) => {
              setVehicleId(event.target.value);
              resetCustomer();
              const car = cars.find((candidate) => candidate.id === event.target.value);
              if (car?.price != null) setPrice(String(car.price));
            }}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Choose a vehicle</option>
            {cars.map((car) => (
              <option key={car.id} value={car.id}>
                {car.title || [car.make, car.model].filter(Boolean).join(' ') || car.advertId} · {car.price != null ? formatPrice(car.price, car.currency) : 'Price to confirm'}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-xl border bg-muted/20 p-4 sm:col-span-2">
          <div className="flex items-start gap-3">
            <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-bold">Customer details</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You do not need to type them here. Use a recent enquiry or let the customer enter their own details.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="space-y-2 text-sm font-semibold">
              <span>Use a recent enquiry</span>
              <select
                value={enquiryId}
                onChange={(event) => chooseEnquiry(event.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Choose an enquiry…</option>
                {recentEnquiries.slice(0, 10).map((enquiry) => (
                  <option key={enquiry.id} value={enquiry.id}>
                    {enquiry.customerName} · {typeLabels[enquiry.type]} · {formatDate(enquiry.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              className="mt-6 md:mt-0"
              onClick={generateCustomerLink}
              disabled={createIntake.isPending || !vehicleId}
            >
              <QrCode className="mr-2 h-4 w-4" />
              {createIntake.isPending ? 'Generating…' : 'Generate customer QR'}
            </Button>
          </div>
          {selectedCustomer && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-950">
              <p className="font-bold">Customer ready</p>
              <p className="mt-1">{selectedCustomer.name}</p>
              <p className="text-green-900/75">{selectedCustomer.email || selectedCustomer.phone || 'No contact method provided'}</p>
              <button type="button" className="mt-2 text-xs font-bold text-green-900 underline" onClick={resetCustomer}>Choose a different customer</button>
            </div>
          )}
          {customerMode === 'qr' && intakePath && !intakeCustomer && (
            <div className="mt-5 flex flex-col items-center gap-4 rounded-xl border bg-background p-4 text-center sm:flex-row sm:text-left">
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <QRCodeSVG value={customerDetailsUrl} size={180} includeMargin />
              </div>
              <div className="min-w-0">
                <p className="font-bold">Ask the customer to scan this code</p>
                <p className="mt-1 text-sm text-muted-foreground">This screen will fill in automatically when they save their details.</p>
                <Input readOnly value={customerDetailsUrl} className="mt-3 text-xs" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(customerDetailsUrl)}><Copy className="mr-2 h-3.5 w-3.5" />Copy link</Button>
                  <Button type="button" size="sm" variant="outline" asChild><a href={customerDetailsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" />Open form</a></Button>
                </div>
              </div>
            </div>
          )}
          {intakeQuery.isError && <p className="mt-3 text-sm text-destructive">This customer link is unavailable. Generate a new one.</p>}
          {createIntake.isError && <p className="mt-3 text-sm text-destructive">{apiMessage(createIntake.error, 'Could not generate a customer link.')}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-2 text-sm font-semibold">
            <span>Total (£)</span>
            <Input required min="0" step="0.01" type="number" value={price} onChange={(event) => setPrice(event.target.value)} placeholder={selectedCar?.price != null ? String(selectedCar.price) : '0.00'} />
          </label>
          <label className="space-y-2 text-sm font-semibold">
            <span>Deposit (£)</span>
            <Input min="0" step="0.01" type="number" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
          </label>
        </div>
        <label className="space-y-2 text-sm font-semibold sm:col-span-2">
          <span>Vehicle disclosures</span>
          <Textarea required rows={3} value={disclosures} onChange={(event) => setDisclosures(event.target.value)} />
        </label>
        <label className="space-y-2 text-sm font-semibold sm:col-span-2">
          <span>Fulfilment</span>
          <select
            required
            value={fulfilmentMethod}
            onChange={(event) => setFulfilmentMethod(event.target.value as 'collection' | 'delivery')}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="collection">Customer collection</option>
            <option value="delivery">Dealer delivery</option>
          </select>
          <span className="block text-xs font-normal text-muted-foreground">The date and address can be added to the fulfilment record before signing.</span>
        </label>
      </div>
      {createSale.isError && <p className="mt-4 text-sm text-destructive">{apiMessage(createSale.error, 'Could not create this sale.')}</p>}
      <Button type="submit" className="mt-5 font-bold" disabled={createSale.isPending || !vehicleId || !selectedCustomer}>
        <Plus className="mr-2 h-4 w-4" /> {createSale.isPending ? 'Creating deal…' : 'Create draft sale'}
      </Button>
      {!selectedCustomer && <p className="mt-3 text-sm text-muted-foreground">Select a recent enquiry or wait for the customer to save their details before creating the draft.</p>}
    </form>
  );
}

function SaleDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const saleQuery = useGetSale(id, { query: { queryKey: getGetSaleQueryKey(id), refetchInterval: 4000 } });
  const checksQuery = useGetSaleFinalChecks(id, { query: { queryKey: getGetSaleFinalChecksQueryKey(id), refetchInterval: 5000 } });
  const checklistQuery = useGetSaleChecklist(id, { query: { queryKey: getGetSaleChecklistQueryKey(id), refetchInterval: 5000 } });
  const prepare = usePrepareSale({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ['/api/sales', id] });
        queryClient.invalidateQueries({ queryKey: ['/api/sales', id, 'final-checks'] });
      },
    },
  });
  const revoke = useRevokeSaleSigning({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ['/api/sales', id] });
      },
    },
  });
  const complete = useCompleteSale({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ['/api/sales', id] });
        queryClient.invalidateQueries({ queryKey: ['/api/sales', id, 'final-checks'] });
      },
    },
  });
  const sale = saleView(saleQuery.data);
  const checks = (checksQuery.data as unknown as { canComplete?: boolean; checks?: SaleCheck[] } | undefined);
  const prepared = prepare.data as unknown as { signingUrl?: string; revision?: { revisionNumber: number; packHash: string } } | undefined;
  const checklist = checklistQuery.data as unknown as SaleChecklistView | undefined;

  if (saleQuery.isLoading || !sale) {
    return <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-card text-muted-foreground"><LoaderCircle className="mr-2 h-5 w-5 animate-spin text-primary" /> Loading sale…</div>;
  }

  const sessionStatus = sale.signingSession?.status;
  const canPrepare = !['completed', 'cancelled'].includes(sale.status) && sessionStatus !== 'pending';
  const readyForPreparation = checklist?.readyForPreparation ?? false;

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button type="button" onClick={onBack} className="mb-3 text-sm font-bold text-primary hover:underline">← All sales</button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sale.status === 'completed' ? 'default' : 'secondary'}>{sale.status}</Badge>
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sale {sale.id.slice(0, 8)}</span>
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight">{sale.customer?.name || 'Unnamed customer'}</h2>
          <p className="mt-1 text-muted-foreground">{sale.vehicle?.title || 'Vehicle'}{sale.vehicle?.registration ? ` · ${sale.vehicle.registration}` : ''}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total</p>
          <p className="mt-1 text-3xl font-black text-primary">{formatPence(sale.agreedPricePence)}</p>
          <p className="text-sm text-muted-foreground">Balance {formatPence(sale.balancePence)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer</p>
          <p className="mt-2 font-bold">{sale.customer?.name}</p>
          <p className="text-sm text-muted-foreground">{sale.customer?.email || sale.customer?.phone || 'No contact recorded'}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Revision</p>
          <p className="mt-2 font-bold">{sale.latestRevision ? `Revision ${sale.latestRevision.revisionNumber}` : 'Not prepared'}</p>
          <p className="text-sm text-muted-foreground">{sale.latestRevision?.status || 'Draft terms'}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Signing</p>
          <p className="mt-2 font-bold">{sessionStatus || 'Not started'}</p>
          {sale.signingSession?.expiresAt && <p className="text-sm text-muted-foreground">Expires {formatDate(sale.signingSession.expiresAt)}</p>}
        </div>
      </div>

      {prepared?.signingUrl && (
        <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><Link2 className="h-4 w-4" /> Secure signing link ready</p>
            <h3 className="mt-2 text-xl font-black">Send this link to the customer</h3>
            <p className="mt-2 text-sm text-muted-foreground">The link expires automatically and is bound to revision {prepared.revision?.revisionNumber}. Open it yourself or copy it into an email or message.</p>
            <div className="mt-4 flex flex-col gap-2 lg:flex-row">
              <Input readOnly value={prepared.signingUrl || ''} className="text-xs" />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => prepared.signingUrl && navigator.clipboard?.writeText(prepared.signingUrl)}><Copy className="mr-2 h-4 w-4" /> Copy link</Button>
                <Button type="button" variant="outline" asChild><a href={prepared.signingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Open link</a></Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {canPrepare && <Button type="button" onClick={() => prepare.mutate({ id })} disabled={prepare.isPending || !readyForPreparation}><Link2 className="mr-2 h-4 w-4" /> {prepare.isPending ? 'Preparing pack…' : !readyForPreparation ? 'Complete checklist to prepare' : sale.latestRevision ? 'Create new revision & link' : 'Prepare pack & create link'}</Button>}
        {sessionStatus === 'pending' && <Button type="button" variant="outline" onClick={() => revoke.mutate({ id })} disabled={revoke.isPending}><XCircle className="mr-2 h-4 w-4" /> Revoke signing link</Button>}
        {checks?.canComplete && sale.status === 'signed' && <Button type="button" variant="secondary" onClick={() => complete.mutate({ id })} disabled={complete.isPending}><CheckCircle2 className="mr-2 h-4 w-4" /> {complete.isPending ? 'Completing…' : 'Complete sale'}</Button>}
      </div>
      {(prepare.isError || revoke.isError || complete.isError) && <p className="mt-3 text-sm text-destructive">{apiMessage(prepare.error || revoke.error || complete.error, 'The sale action could not be completed.')}</p>}

      <DealChecklist id={id} />

      <div className="mt-7 border-t pt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-black"><ClipboardCheck className="h-5 w-5 text-primary" /> Final-sale checks</h3>
          <span className={`text-sm font-bold ${sale.status === 'completed' || checks?.canComplete ? 'text-green-700' : 'text-amber-700'}`}>{sale.status === 'completed' ? 'Completed' : checks?.canComplete ? 'Ready to complete' : 'Not ready'}</span>
        </div>
        {checksQuery.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Checking sale readiness…</p> : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(checks?.checks || []).map((check) => (
              <div key={check.code} className={`rounded-lg border p-3 ${check.passed ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                <p className={`flex items-center gap-2 text-sm font-bold ${check.passed ? 'text-green-900' : 'text-amber-950'}`}>{check.passed ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}{check.label}</p>
                <p className={`mt-1 text-xs ${check.passed ? 'text-green-800/80' : 'text-amber-900/80'}`}>{check.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {sale.invoice && <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-950"><p className="font-bold">Development invoice created · {sale.invoice.invoiceNumber}</p><p className="mt-1 text-green-900/80">Invoice and Deal Vault are metadata-only foundations pending legal, tax, and private storage decisions.</p></div>}
    </section>
  );
}

function EnquiryCard({ enquiry }: { enquiry: Enquiry }) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateEnquiryStatus({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
    },
  });
  const vehicleLabel = enquiry.vehicleTitle || 'General showroom enquiry';

  return (
    <article className="rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(enquiry.status)}>{statusLabels[enquiry.status]}</Badge>
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{typeLabels[enquiry.type]}</span>
          </div>
          <h2 className="mt-3 text-xl font-black tracking-tight">{enquiry.customerName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(enquiry.createdAt)}</p>
          {enquiry.appointmentAt && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm font-bold text-primary">
              <CalendarDays className="h-4 w-4" /> Viewing: {formatDate(enquiry.appointmentAt)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {enquiry.status !== 'new' && (
            <Button
              size="sm"
              variant="outline"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: enquiry.id, data: { status: 'new' } })}
            >
              Mark new
            </Button>
          )}
          {enquiry.status !== 'contacted' && (
            <Button
              size="sm"
              variant="outline"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: enquiry.id, data: { status: 'contacted' } })}
            >
              Mark contacted
            </Button>
          )}
          {enquiry.status !== 'closed' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: enquiry.id, data: { status: 'closed' } })}
            >
              Close
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-y py-5 md:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer contact</p>
          <div className="mt-3 space-y-2 text-sm">
            {enquiry.phone && <a className="flex items-center gap-2 font-semibold text-foreground hover:text-primary" href={`tel:${enquiry.phone.replace(/[^0-9+]/g, '')}`}><Phone className="h-4 w-4 text-primary" />{enquiry.phone}</a>}
            {enquiry.email && <a className="flex items-center gap-2 font-semibold text-foreground hover:text-primary" href={`mailto:${enquiry.email}`}><Mail className="h-4 w-4 text-primary" />{enquiry.email}</a>}
            <p className="flex items-center gap-2 text-muted-foreground"><MessageSquare className="h-4 w-4" />Prefers {enquiry.preferredContact || 'any contact method'}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Vehicle context</p>
          <div className="mt-3">
            <p className="font-bold">{vehicleLabel}</p>
            {enquiry.vehicleRegistration && <p className="mt-1 text-sm text-muted-foreground">{enquiry.vehicleRegistration}{enquiry.vehiclePrice != null ? ` · ${formatPrice(enquiry.vehiclePrice, 'GBP')}` : ''}</p>}
            {enquiry.vehicleUrl && (
              <Link href={enquiry.vehicleUrl} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                View vehicle <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Message</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{enquiry.message}</p>
      </div>
      <div className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer confirmation</p>
          <p className={`mt-1 text-sm font-bold ${enquiry.customerNotificationStatus === 'failed' ? 'text-destructive' : 'text-foreground'}`}>
            {deliveryLabel(enquiry.customerNotificationStatus)}
          </p>
          {enquiry.customerNotificationError && <p className="mt-1 text-xs text-destructive">{enquiry.customerNotificationError}</p>}
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dealer notification</p>
          <p className={`mt-1 text-sm font-bold ${enquiry.dealerNotificationStatus === 'failed' ? 'text-destructive' : 'text-foreground'}`}>
            {deliveryLabel(enquiry.dealerNotificationStatus)}
          </p>
          {enquiry.dealerNotificationError && <p className="mt-1 text-xs text-destructive">{enquiry.dealerNotificationError}</p>}
        </div>
        {enquiry.appointmentAt && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Reminder · Europe/London</p>
            <p className={`mt-1 text-sm font-bold ${enquiry.reminderStatus === 'failed' ? 'text-destructive' : 'text-foreground'}`}>
              {enquiry.reminderStatus === 'not_scheduled' ? 'Not scheduled' : deliveryLabel(enquiry.reminderStatus)}
            </p>
            {enquiry.reminderError && <p className="mt-1 text-xs text-destructive">{enquiry.reminderError}</p>}
          </div>
        )}
      </div>
      {updateStatus.isError && <p className="mt-4 text-sm text-destructive">Could not update this enquiry. Please try again.</p>}
    </article>
  );
}

export default function Portal() {
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const [filter, setFilter] = useState<'all' | Enquiry['status']>('all');
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [saleFocusMode, setSaleFocusMode] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const enquiryQuery = useGetEnquiries(filter === 'all' ? undefined : { status: filter });
  const recentEnquiriesQuery = useGetEnquiries();
  const salesQuery = useGetSales({ query: { queryKey: getGetSalesQueryKey(), refetchInterval: 5000 } });
  const enquiries = enquiryQuery.data ?? [];
  const sales = salesQuery.data ?? [];
  const newCount = enquiries.filter((enquiry) => enquiry.status === 'new').length;

  useEffect(() => {
    if (!showSaleForm || !saleFocusMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [saleFocusMode, showSaleForm]);

  const openNewSale = () => {
    setSelectedSaleId(null);
    setShowSaleForm(true);
    setSaleFocusMode(true);
  };

  const closeNewSale = () => {
    setShowSaleForm(false);
    setSaleFocusMode(false);
  };

  const handleSaleCreated = (saleId: string) => {
    setShowSaleForm(false);
    setSaleFocusMode(false);
    setSelectedSaleId(saleId);
    void salesQuery.refetch();
  };

  if (showSaleForm && saleFocusMode) {
    return (
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-labelledby="focused-sale-title">
        <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,_hsl(var(--accent)/0.14),_transparent_38%),linear-gradient(135deg,_hsl(var(--background)),_hsl(var(--muted)/0.45))] px-4 py-6 sm:px-8 sm:py-10">
          <div className="mx-auto flex max-w-4xl items-start justify-between gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-primary">Focused sales workspace</p>
              <h1 id="focused-sale-title" className="mt-3 max-w-xl text-3xl font-black tracking-tight sm:text-5xl">
                Build the deal, one step at a time.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                The rest of the portal is tucked away while you prepare this sale. Customer details can be selected from an enquiry or collected by QR code.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 bg-background/80 font-bold shadow-sm"
              onClick={() => setSaleFocusMode(false)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Show full portal</span>
              <span className="sm:hidden">Portal</span>
            </Button>
          </div>
          <div className="mx-auto mt-8 max-w-4xl pb-8">
            <SaleCreateForm recentEnquiries={recentEnquiriesQuery.data ?? []} onCreated={handleSaleCreated} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] bg-muted/20 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary"><Inbox className="h-4 w-4" /> Dealer portal</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Enquiry inbox</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">Keep customer requests, viewing bookings, and vehicle conversations in one place.</p>
          </div>
          <Link href="/" className="text-sm font-bold text-primary hover:underline">Back to showroom</Link>
        </div>

        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div><p className="font-bold">Temporary access notice</p><p className="mt-1 text-amber-900/80">This portal is intentionally passwordless during setup. Add authentication before sharing this URL beyond your team.</p></div>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-sm font-semibold text-muted-foreground">Inbox total</p><p className="mt-2 text-3xl font-black">{enquiries.length}</p></div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-sm font-semibold text-muted-foreground">Needs attention</p><p className="mt-2 text-3xl font-black text-primary">{newCount}</p></div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground">Showroom stock</p>
            {stockLoading ? <LoaderCircle className="mt-3 h-6 w-6 animate-spin text-primary" /> : stockError ? <p className="mt-2 flex items-center gap-2 text-sm text-destructive"><CircleAlert className="h-4 w-4" />Unavailable</p> : <p className="mt-2 flex items-center gap-2 text-3xl font-black"><CheckCircle2 className="h-6 w-6 text-green-600" />{stock?.cars.length ?? 0}</p>}
          </div>
        </div>

        <section className="mb-10">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary"><ClipboardCheck className="h-4 w-4" /> Digital sales</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">Deal workspace</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create a development sale, prepare a hashed document pack, and send a secure signing link before production decisions are made.</p>
            </div>
            <Button type="button" variant={showSaleForm ? 'outline' : 'default'} onClick={showSaleForm ? closeNewSale : openNewSale}><Plus className="mr-2 h-4 w-4" />{showSaleForm ? 'Hide new sale' : 'New development sale'}</Button>
          </div>
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div><p className="font-bold">DEVELOPMENT ONLY</p><p className="mt-1 text-amber-900/80">Demo signatures, templates, invoice metadata, and the passwordless staff portal are not production-ready. Staff authentication and legal review are required before any real sale.</p></div>
          </div>
          {showSaleForm && <div className="mb-5"><SaleCreateForm recentEnquiries={recentEnquiriesQuery.data ?? []} onCreated={handleSaleCreated} /></div>}
          {selectedSaleId ? (
            <SaleDetail id={selectedSaleId} onBack={() => setSelectedSaleId(null)} />
          ) : salesQuery.isLoading ? (
            <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-card text-muted-foreground"><LoaderCircle className="mr-2 h-5 w-5 animate-spin text-primary" /> Loading development sales…</div>
          ) : salesQuery.isError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900"><p className="font-bold">Could not load development sales</p><p className="mt-1">The sale workspace may need a database migration or a refresh.</p></div>
          ) : sales.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card p-8 text-center"><ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="text-lg font-black">No development sales yet</h3><p className="mt-1 text-sm text-muted-foreground">Start with an existing vehicle and customer details to generate a secure signing link.</p></div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {sales.map((value) => {
                const sale = saleView(value);
                if (!sale) return null;
                return (
                  <button key={sale.id} type="button" onClick={() => setSelectedSaleId(sale.id)} className="rounded-2xl border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><Badge variant={sale.status === 'completed' ? 'default' : 'secondary'}>{sale.status}</Badge>{sale.signingSession?.status === 'pending' && <Badge variant="outline"><Link2 className="mr-1 h-3 w-3" /> Signing link active</Badge>}</div>
                        <h3 className="mt-3 text-xl font-black">{sale.customer?.name || 'Unnamed customer'}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{sale.vehicle?.title || 'Vehicle'}{sale.vehicle?.registration ? ` · ${sale.vehicle.registration}` : ''}</p>
                      </div>
                      <p className="text-lg font-black text-primary">{formatPence(sale.agreedPricePence)}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-muted-foreground"><span>Deposit {formatPence(sale.depositPence)}</span><span>Balance {formatPence(sale.balancePence)}</span><span>{sale.latestRevision ? `Revision ${sale.latestRevision.revisionNumber}` : 'Pack not prepared'}</span></div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

         <DealerSettingsPanel />

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'new', 'contacted', 'closed'] as const).map((value) => (
              <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>
                {value === 'all' ? 'All enquiries' : statusLabels[value]}
              </Button>
            ))}
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />Newest first</p>
        </div>

        {enquiryQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center rounded-2xl border bg-card text-muted-foreground"><LoaderCircle className="mr-3 h-5 w-5 animate-spin text-primary" />Loading enquiries…</div>
        ) : enquiryQuery.isError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-900"><CircleAlert className="mx-auto mb-3 h-7 w-7" /><p className="font-bold">Could not load the enquiry inbox</p><p className="mt-1 text-sm">Refresh the page and try again.</p></div>
        ) : enquiries.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-12 text-center"><Inbox className="mx-auto mb-4 h-9 w-9 text-muted-foreground" /><h2 className="text-xl font-black">No enquiries here yet</h2><p className="mt-2 text-muted-foreground">{filter === 'all' ? 'New customer requests will appear here after they submit the showroom form.' : `There are no ${statusLabels[filter].toLowerCase()} enquiries.`}</p></div>
        ) : (
          <div className="space-y-4">{enquiries.map((enquiry) => <EnquiryCard key={enquiry.id} enquiry={enquiry} />)}</div>
        )}
      </div>
    </div>
  );
}