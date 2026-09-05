import { useEffect, useState } from 'react';
import {
  getGetSalesQueryKey,
  getGetSaleFinalChecksQueryKey,
  getGetSaleChecklistQueryKey,
  getGetSaleQueryKey,
  getGetCustomerIntakeSessionQueryKey,
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
  useUpdateSaleChecklistItem,
  type Enquiry,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import {
  CheckCircle2,
  ClipboardCheck,
  CircleAlert,
  Copy,
  ArrowLeft,
  ExternalLink,
  Link2,
  LoaderCircle,
  Plus,
  QrCode,
  ShieldAlert,
  UserRound,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStock } from '@/lib/stock-context';
import { formatPrice } from '@/lib/utils';

const typeLabels: Record<Enquiry['type'], string> = {
  viewing: 'Viewing',
  general: 'General',
  delivery: 'Delivery',
  warranty: 'Warranty',
  part_exchange: 'Part exchange',
};

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

function formatPence(value: number | undefined) {
  return formatPrice((value ?? 0) / 100, 'GBP');
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
    <div className="mt-7 rounded-none border border-border bg-card p-5 shadow-none luxxy-surface sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="luxxy-kicker text-primary">Auditable workflow</p>
          <h3 className="mt-2 flex items-center gap-2 font-display text-[1.5rem] font-semibold tracking-[-.02em] text-primary"><ClipboardCheck className="h-5 w-5 text-accent" /> Sales readiness checklist</h3>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            Confirm each deal fact against the current records. If a price, customer, vehicle or document revision changes, the relevant confirmation returns to review.
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="font-display text-[2rem] font-semibold leading-none tracking-[-.03em] text-primary">{completedCount}/{totalCount}</p>
          <p className="luxxy-label mt-1 text-muted-foreground">Current items</p>
        </div>
      </div>
      <div className="mt-5 h-1 overflow-hidden bg-muted/40">
        <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
      {checklistQuery.isLoading ? (
        <p className="mt-6 flex items-center text-[13px] font-semibold text-muted-foreground"><LoaderCircle className="mr-2 h-4 w-4 animate-spin text-accent" /> Loading checklist…</p>
      ) : checklistQuery.isError ? (
        <p className="mt-6 text-[13px] font-semibold text-destructive">The checklist could not be loaded. Refresh and try again.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {(checklist?.items ?? []).map((item) => {
            const confirmed = item.status === 'complete' || item.status === 'not_applicable';
            const invalidated = item.status === 'invalidated';
            return (
              <div key={item.code} className={`rounded-none border p-4 transition-colors ${confirmed ? 'border-[#1b6543]/20 bg-[#1b6543]/5' : invalidated ? 'border-destructive/30 bg-destructive/5' : 'bg-background hover:border-primary/20'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className={`flex items-center gap-2 text-[13px] font-bold ${confirmed ? 'text-[#1b6543]' : invalidated ? 'text-destructive' : 'text-primary'}`}>
                      {confirmed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1b6543]" /> : invalidated ? <CircleAlert className="h-4 w-4 shrink-0 text-destructive" /> : <span className="h-4 w-4 shrink-0 rounded-none border border-muted-foreground/40" />}
                      {item.label}
                      {item.status === 'not_applicable' && <span className="luxxy-label ml-2 border border-border px-1.5 py-0.5 text-muted-foreground">Not applicable</span>}
                    </p>
                    <p className={`mt-1.5 text-[13px] leading-relaxed ${confirmed ? 'text-[#1b6543]/80' : invalidated ? 'text-destructive/80' : 'text-muted-foreground'}`}>{item.message}</p>
                    {confirmed && item.completedAt && <p className="mt-2 font-mono text-[11px] text-muted-foreground">Confirmed {formatDate(item.completedAt)} · {item.completedBy || 'staff'}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!confirmed && item.eligible && (
                      <Button type="button" size="sm" className="rounded-none font-bold tracking-wide" onClick={() => update(item.code, 'complete')} disabled={updateItem.isPending}>
                        Confirm
                      </Button>
                    )}
                    {!confirmed && item.canMarkNotApplicable && item.eligible && (
                      <Button type="button" size="sm" variant="outline" className="rounded-none font-bold tracking-wide" onClick={() => update(item.code, 'not_applicable')} disabled={updateItem.isPending}>
                        N/A
                      </Button>
                    )}
                    {confirmed && item.code !== 'documents_generated' && (
                      <Button type="button" size="sm" variant="ghost" className="rounded-none text-[12px] font-bold uppercase tracking-[.08em] hover:bg-transparent hover:text-accent" onClick={() => update(item.code, 'pending')} disabled={updateItem.isPending}>
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
      {updateItem.isError && <p className="mt-4 text-[13px] font-semibold text-destructive">{apiMessage(updateItem.error, 'That checklist item could not be updated.')}</p>}
      {checklist && !checklist.readyForPreparation && (
        <p className="mt-5 border border-amber-500/20 bg-amber-50/50 px-4 py-3 text-[13px] font-bold text-amber-900">Complete the pre-signature items above before preparing the document pack.</p>
      )}
      {checklist?.readyForPreparation && !checklist.readyForCompletion && (
        <p className="mt-5 border border-accent/20 bg-accent/5 px-4 py-3 text-[13px] font-bold text-primary">Pre-signature checks are complete. Prepare the document pack to create the final document item.</p>
      )}
    </div>
  );
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
    <form onSubmit={submit} className="rounded-none border border-border bg-card p-6 shadow-none luxxy-surface sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-border/70 pb-5">
        <div>
          <p className="luxxy-kicker text-primary">New development sale</p>
          <h2 className="mt-2 font-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-.02em] text-primary">Start a deal</h2>
        </div>
        <span className="luxxy-label border border-border px-2 py-1 text-muted-foreground">Demo only</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2 text-[13px] font-bold sm:col-span-2">
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
            className="flex h-11 w-full rounded-none border border-input bg-background px-3 py-2 text-[13px] transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0"
          >
            <option value="">Choose a vehicle</option>
            {cars.map((car) => (
              <option key={car.id} value={car.id}>
                {car.title || [car.make, car.model].filter(Boolean).join(' ') || car.advertId} · {car.price != null ? formatPrice(car.price, car.currency) : 'Price to confirm'}
              </option>
            ))}
          </select>
        </label>
        <div className="border border-border bg-secondary/20 p-5 sm:col-span-2">
          <div className="flex items-start gap-3">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="text-[13px] font-bold text-primary">Customer details</p>
              <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                You do not need to type them here. Use a recent enquiry or let the customer enter their own details.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
            <label className="space-y-2 text-[13px] font-bold">
              <span>Use a recent enquiry</span>
              <select
                value={enquiryId}
                onChange={(event) => chooseEnquiry(event.target.value)}
                className="flex h-11 w-full rounded-none border border-input bg-background px-3 py-2 text-[13px] transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0"
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
              className="mt-6 h-11 rounded-none text-[12px] font-bold uppercase tracking-[.08em] md:mt-0"
              onClick={generateCustomerLink}
              disabled={createIntake.isPending || !vehicleId}
            >
              <QrCode className="mr-2 h-4 w-4 text-accent" />
              {createIntake.isPending ? 'Generating…' : 'Generate customer QR'}
            </Button>
          </div>
          {selectedCustomer && (
            <div className="mt-5 border border-[#1b6543]/20 bg-[#1b6543]/5 p-4 text-[13px] text-primary">
              <p className="font-bold text-[#1b6543]">Customer ready</p>
              <p className="mt-1.5 font-semibold">{selectedCustomer.name}</p>
              <p className="text-[#1b6543]/80">{selectedCustomer.email || selectedCustomer.phone || 'No contact method provided'}</p>
              <button type="button" className="luxxy-label mt-3 text-accent hover:text-primary transition-colors" onClick={resetCustomer}>Choose a different customer</button>
            </div>
          )}
          {customerMode === 'qr' && intakePath && !intakeCustomer && (
            <div className="mt-6 flex flex-col items-center gap-5 border border-border bg-background p-5 text-center sm:flex-row sm:text-left">
              <div className="border border-border/50 bg-white p-3 shadow-sm">
                <QRCodeSVG value={customerDetailsUrl} size={160} includeMargin />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-primary">Ask the customer to scan this code</p>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">This screen will fill in automatically when they save their details.</p>
                <Input readOnly value={customerDetailsUrl} className="mt-4 h-9 rounded-none font-mono text-[11px]" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" className="rounded-none text-[11px] font-bold uppercase tracking-wider" onClick={() => navigator.clipboard?.writeText(customerDetailsUrl)}><Copy className="mr-2 h-3.5 w-3.5" />Copy link</Button>
                  <Button type="button" size="sm" variant="outline" className="rounded-none text-[11px] font-bold uppercase tracking-wider" asChild><a href={customerDetailsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" />Open form</a></Button>
                </div>
              </div>
            </div>
          )}
          {intakeQuery.isError && <p className="mt-4 text-[13px] font-semibold text-destructive">This customer link is unavailable. Generate a new one.</p>}
          {createIntake.isError && <p className="mt-4 text-[13px] font-semibold text-destructive">{apiMessage(createIntake.error, 'Could not generate a customer link.')}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-2 text-[13px] font-bold">
            <span>Total (£)</span>
            <Input required min="0" step="0.01" type="number" className="h-11 rounded-none font-mono focus-visible:border-accent focus-visible:ring-0" value={price} onChange={(event) => setPrice(event.target.value)} placeholder={selectedCar?.price != null ? String(selectedCar.price) : '0.00'} />
          </label>
          <label className="space-y-2 text-[13px] font-bold">
            <span>Deposit (£)</span>
            <Input min="0" step="0.01" type="number" className="h-11 rounded-none font-mono focus-visible:border-accent focus-visible:ring-0" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
          </label>
        </div>
        <label className="space-y-2 text-[13px] font-bold sm:col-span-2">
          <span>Vehicle disclosures</span>
          <Textarea required rows={3} className="rounded-none focus-visible:border-accent focus-visible:ring-0" value={disclosures} onChange={(event) => setDisclosures(event.target.value)} />
        </label>
        <label className="space-y-2 text-[13px] font-bold sm:col-span-2">
          <span>Fulfilment</span>
          <select
            required
            value={fulfilmentMethod}
            onChange={(event) => setFulfilmentMethod(event.target.value as 'collection' | 'delivery')}
            className="flex h-11 w-full rounded-none border border-input bg-background px-3 py-2 text-[13px] transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0"
          >
            <option value="collection">Customer collection</option>
            <option value="delivery">Dealer delivery</option>
          </select>
          <span className="block text-[12px] font-normal text-muted-foreground">The date and address can be added to the fulfilment record before signing.</span>
        </label>
      </div>
      {createSale.isError && <p className="mt-5 text-[13px] font-semibold text-destructive">{apiMessage(createSale.error, 'Could not create this sale.')}</p>}
      <Button type="submit" className="mt-6 h-12 rounded-none text-[13px] font-bold uppercase tracking-[.08em]" disabled={createSale.isPending || !vehicleId || !selectedCustomer}>
        <Plus className="mr-2 h-4 w-4" /> {createSale.isPending ? 'Creating deal…' : 'Create draft sale'}
      </Button>
      {!selectedCustomer && <p className="mt-3 text-[13px] text-muted-foreground">Select a recent enquiry or wait for the customer to save their details before creating the draft.</p>}
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
    return <div className="flex min-h-48 items-center justify-center border border-border bg-card text-[13px] font-semibold text-muted-foreground"><LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" /> Loading sale…</div>;
  }

  const sessionStatus = sale.signingSession?.status;
  const canPrepare = !['completed', 'cancelled'].includes(sale.status) && sessionStatus !== 'pending';
  const readyForPreparation = checklist?.readyForPreparation ?? false;

  return (
    <section className="rounded-none border border-border bg-card p-5 shadow-none luxxy-surface sm:p-7">
      <div className="flex flex-col gap-5 border-b border-border/70 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button type="button" onClick={onBack} className="luxxy-label mb-4 flex items-center gap-2 text-muted-foreground hover:text-accent transition-colors"><ArrowLeft className="h-3 w-3" /> All sales</button>
          <div className="flex flex-wrap items-center gap-3">
            <span className="luxxy-label border border-border px-2 py-1 text-primary">{sale.status}</span>
            <span className="font-mono text-[11px] font-bold text-muted-foreground">Ref {sale.id.slice(0, 8)}</span>
          </div>
          <h2 className="mt-4 font-display text-[2rem] font-semibold leading-[1.05] tracking-[-.03em] text-primary">{sale.customer?.name || 'Unnamed customer'}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{sale.vehicle?.title || 'Vehicle'}{sale.vehicle?.registration ? ` · ` : ''}{sale.vehicle?.registration ? <span className="font-mono">{sale.vehicle.registration}</span> : ''}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="luxxy-label text-muted-foreground">Total</p>
          <p className="luxxy-price mt-2 text-[2.25rem] leading-none text-primary">{formatPence(sale.agreedPricePence)}</p>
          <p className="mt-2 text-[13px] text-muted-foreground">Balance <span className="luxxy-price-inline text-foreground">{formatPence(sale.balancePence)}</span></p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="border border-border bg-secondary/15 p-5">
          <p className="luxxy-label text-muted-foreground">Customer</p>
          <p className="mt-3 text-[13px] font-bold text-primary">{sale.customer?.name}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{sale.customer?.email || sale.customer?.phone || 'No contact recorded'}</p>
        </div>
        <div className="border border-border bg-secondary/15 p-5">
          <p className="luxxy-label text-muted-foreground">Revision</p>
          <p className="mt-3 text-[13px] font-bold text-primary">{sale.latestRevision ? `Revision ${sale.latestRevision.revisionNumber}` : 'Not prepared'}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{sale.latestRevision?.status || 'Draft terms'}</p>
        </div>
        <div className="border border-border bg-secondary/15 p-5">
          <p className="luxxy-label text-muted-foreground">Signing</p>
          <p className="mt-3 text-[13px] font-bold text-primary">{sessionStatus || 'Not started'}</p>
          {sale.signingSession?.expiresAt && <p className="mt-1 text-[13px] text-muted-foreground">Expires {formatDate(sale.signingSession.expiresAt)}</p>}
        </div>
      </div>

      {prepared?.signingUrl && (
        <div className="mt-8 border border-accent/30 bg-accent/5 p-6">
          <div>
            <p className="luxxy-kicker text-accent"><Link2 className="h-3.5 w-3.5" /> Secure signing link ready</p>
            <h3 className="mt-3 font-display text-[1.5rem] font-semibold tracking-[-.02em] text-primary">Send this link to the customer</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">The link expires automatically and is bound to revision <span className="font-mono">{prepared.revision?.revisionNumber}</span>. Open it yourself or copy it into an email or message.</p>
            <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
              <Input readOnly value={prepared.signingUrl || ''} className="h-11 rounded-none font-mono text-[11px] lg:max-w-md focus-visible:ring-0 focus-visible:border-accent" />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" className="h-11 rounded-none text-[12px] font-bold uppercase tracking-[.08em]" onClick={() => prepared.signingUrl && navigator.clipboard?.writeText(prepared.signingUrl)}><Copy className="mr-2 h-4 w-4 text-accent" /> Copy link</Button>
                <Button type="button" variant="outline" className="h-11 rounded-none text-[12px] font-bold uppercase tracking-[.08em]" asChild><a href={prepared.signingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4 text-accent" /> Open link</a></Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        {canPrepare && <Button type="button" className="h-11 rounded-none text-[12px] font-bold uppercase tracking-[.08em]" onClick={() => prepare.mutate({ id })} disabled={prepare.isPending || !readyForPreparation}><Link2 className="mr-2 h-4 w-4" /> {prepare.isPending ? 'Preparing pack…' : !readyForPreparation ? 'Complete checklist to prepare' : sale.latestRevision ? 'Create new revision & link' : 'Prepare pack & create link'}</Button>}
        {sessionStatus === 'pending' && <Button type="button" variant="outline" className="h-11 rounded-none text-[12px] font-bold uppercase tracking-[.08em] hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30" onClick={() => revoke.mutate({ id })} disabled={revoke.isPending}><XCircle className="mr-2 h-4 w-4" /> Revoke signing link</Button>}
        {checks?.canComplete && sale.status === 'signed' && <Button type="button" variant="outline" className="h-11 rounded-none border-primary/20 bg-primary text-primary-foreground text-[12px] font-bold uppercase tracking-[.08em] hover:bg-accent hover:text-primary" onClick={() => complete.mutate({ id })} disabled={complete.isPending}><CheckCircle2 className="mr-2 h-4 w-4" /> {complete.isPending ? 'Completing…' : 'Complete sale'}</Button>}
      </div>
      {(prepare.isError || revoke.isError || complete.isError) && <p className="mt-4 text-[13px] font-semibold text-destructive">{apiMessage(prepare.error || revoke.error || complete.error, 'The sale action could not be completed.')}</p>}

      <DealChecklist id={id} />

      <div className="mt-8 border-t border-border/70 pt-8">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-[1.5rem] font-semibold tracking-[-.02em] text-primary"><ClipboardCheck className="h-5 w-5 text-accent" /> Final-sale checks</h3>
          <span className={`luxxy-label ${sale.status === 'completed' || checks?.canComplete ? 'text-[#1b6543]' : 'text-amber-700'}`}>{sale.status === 'completed' ? 'Completed' : checks?.canComplete ? 'Ready to complete' : 'Not ready'}</span>
        </div>
        {checksQuery.isLoading ? <p className="mt-5 text-[13px] font-semibold text-muted-foreground">Checking sale readiness…</p> : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(checks?.checks || []).map((check) => (
              <div key={check.code} className={`border p-4 transition-colors ${check.passed ? 'border-[#1b6543]/20 bg-[#1b6543]/5' : 'border-amber-500/30 bg-amber-50/50'}`}>
                <p className={`flex items-center gap-2 text-[13px] font-bold ${check.passed ? 'text-[#1b6543]' : 'text-amber-900'}`}>{check.passed ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}{check.label}</p>
                <p className={`mt-1.5 text-[12px] leading-relaxed ${check.passed ? 'text-[#1b6543]/80' : 'text-amber-900/80'}`}>{check.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {sale.invoice && (
        <div className="mt-8 border border-[#1b6543]/30 bg-[#1b6543]/5 p-5 text-[13px] text-[#1b6543]">
          <p className="font-bold">Development invoice created · <span className="font-mono">{sale.invoice.invoiceNumber}</span></p>
          <p className="mt-1.5 leading-relaxed text-[#1b6543]/80">Invoice and Deal Vault are metadata-only foundations pending legal, tax, and private storage decisions.</p>
        </div>
      )}
    </section>
  );
}

export function DealsPanel() {
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [saleFocusMode, setSaleFocusMode] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  
  const recentEnquiriesQuery = useGetEnquiries();
  const salesQuery = useGetSales({ query: { queryKey: getGetSalesQueryKey(), refetchInterval: 5000 } });
  const sales = salesQuery.data ?? [];

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
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-background luxxy-grain" role="dialog" aria-modal="true" aria-labelledby="focused-sale-title">
        <div className="min-h-[100dvh] luxxy-shell px-4 py-8 sm:px-8 sm:py-12">
          <div className="mx-auto flex max-w-4xl flex-col items-start gap-6 lg:flex-row lg:justify-between lg:items-start">
            <div>
              <p className="luxxy-kicker text-primary">Focused sales workspace</p>
              <h1 id="focused-sale-title" className="mt-4 max-w-xl font-display text-[2.5rem] font-semibold leading-[1.05] tracking-[-.03em] text-primary sm:text-[3.25rem]">
                Build the deal, one step at a time.
              </h1>
              <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]">
                The rest of the portal is tucked away while you prepare this sale. Customer details can be selected from an enquiry or collected by QR code.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-none bg-background/80 text-[12px] font-bold uppercase tracking-[.08em] shadow-none hover:border-accent hover:text-accent"
              onClick={() => setSaleFocusMode(false)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Show full portal</span>
              <span className="sm:hidden">Portal</span>
            </Button>
          </div>
          <div className="mx-auto mt-10 max-w-4xl pb-10">
            <SaleCreateForm recentEnquiries={recentEnquiriesQuery.data ?? []} onCreated={handleSaleCreated} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="mb-12">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="luxxy-kicker text-accent"><ClipboardCheck className="h-3.5 w-3.5" /> Digital sales</p>
          <h2 className="mt-3 font-display text-[2.25rem] font-semibold leading-none tracking-[-.03em] text-primary">Deal workspace</h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">Create a development sale, prepare a hashed document pack, and send a secure signing link before production decisions are made.</p>
        </div>
        <Button type="button" variant={showSaleForm ? 'outline' : 'default'} className={`rounded-none text-[12px] font-bold uppercase tracking-[.08em] ${showSaleForm ? '' : 'shadow-none'}`} onClick={showSaleForm ? closeNewSale : openNewSale}><Plus className="mr-2 h-4 w-4" />{showSaleForm ? 'Hide new sale' : 'New development sale'}</Button>
      </div>
      <div className="mb-8 flex items-start gap-4 border border-amber-500/30 bg-amber-50/50 p-5 text-[13px] text-amber-900">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div><p className="font-bold">DEVELOPMENT ONLY</p><p className="mt-1.5 leading-relaxed text-amber-900/80">Demo signatures, templates, invoice metadata, and the passwordless staff portal are not production-ready. Staff authentication and legal review are required before any real sale.</p></div>
      </div>
      {showSaleForm && <div className="mb-8"><SaleCreateForm recentEnquiries={recentEnquiriesQuery.data ?? []} onCreated={handleSaleCreated} /></div>}
      {selectedSaleId ? (
        <SaleDetail id={selectedSaleId} onBack={() => setSelectedSaleId(null)} />
      ) : salesQuery.isLoading ? (
        <div className="flex min-h-48 items-center justify-center border border-border bg-card text-[13px] font-semibold text-muted-foreground"><LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" /> Loading development sales…</div>
      ) : salesQuery.isError ? (
        <div className="border border-destructive/30 bg-destructive/5 p-8 text-center text-[13px] text-destructive"><p className="font-bold">Could not load development sales</p><p className="mt-1">The sale workspace may need a database migration or a refresh.</p></div>
      ) : sales.length === 0 ? (
        <div className="border border-dashed border-border bg-card p-12 text-center"><ClipboardCheck className="mx-auto mb-4 h-8 w-8 text-muted-foreground" /><h3 className="font-display text-[1.5rem] font-semibold tracking-[-.02em] text-primary">No development sales yet</h3><p className="mt-2 text-[13px] text-muted-foreground">Start with an existing vehicle and customer details to generate a secure signing link.</p></div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {sales.map((value) => {
            const sale = saleView(value);
            if (!sale) return null;
            return (
              <button key={sale.id} type="button" onClick={() => setSelectedSaleId(sale.id)} className="group border border-border bg-card p-6 text-left transition-colors hover:border-accent hover:bg-secondary/10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="luxxy-label border border-border px-2 py-1 text-primary bg-background">{sale.status}</span>
                      {sale.signingSession?.status === 'pending' && <span className="luxxy-label flex items-center gap-1 border border-accent/30 bg-accent/5 px-2 py-1 text-primary"><Link2 className="h-3 w-3 text-accent" /> Signing link active</span>}
                    </div>
                    <h3 className="mt-4 font-display text-[1.25rem] font-semibold tracking-[-.02em] text-primary transition-colors group-hover:text-accent">{sale.customer?.name || 'Unnamed customer'}</h3>
                    <p className="mt-1.5 text-[13px] text-muted-foreground">{sale.vehicle?.title || 'Vehicle'}{sale.vehicle?.registration ? ` · ` : ''}{sale.vehicle?.registration ? <span className="font-mono">{sale.vehicle.registration}</span> : ''}</p>
                  </div>
                  <p className="luxxy-price text-[1.5rem] leading-none text-primary">{formatPence(sale.agreedPricePence)}</p>
                </div>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span>Deposit <span className="luxxy-price-inline text-foreground">{formatPence(sale.depositPence)}</span></span>
                  <span className="luxxy-leader opacity-30" />
                  <span>Balance <span className="luxxy-price-inline text-foreground">{formatPence(sale.balancePence)}</span></span>
                  <span className="luxxy-leader opacity-30" />
                  <span>{sale.latestRevision ? `Revision ${sale.latestRevision.revisionNumber}` : 'Pack not prepared'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}