import { WebsiteContentEditor } from "./website-content-editor";
import { LaunchReadiness, SettingsPreview } from './settings-preview';
import { ShowroomPhoto } from './showroom-photo';
import { ReviewsSettings } from './reviews-settings';
import { ColourField, isValidHsl } from '@/components/brand/colour-field';
import { DealerWordmark } from "@/components/brand/wordmark";
import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getGetDealerSettingsQueryKey,
  type DealerSettings,
  type DealerService,
  type DealerPresentation,
  useGetDealerSettings,
  useUpdateDealerSettings,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useStock } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Image,
  Link2,
  MapPin,
  Palette,
  Plus,
  Save,
  Store,
  Trash2,
  Truck,
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dealerConfig } from '@/config/dealer';
import { readSettingsDraft, writeSettingsDraft, clearSettingsDraft } from '@/lib/settings-draft';

type ServiceKey = 'warranty' | 'delivery' | 'partExchange';
type FormSection =
  | "identity"
  | "contact"
  | "homepage"
  | "services"
  | "proof"
  | "legal"
  | "presentation"
  | "brochure"
  | "pages"
  | "review";

const ActiveSettingsSection = createContext<FormSection | null>(null);
const setupSteps: Array<[FormSection, string, string]> = [
  ["identity", "Your brand", "Name, logo & colours"],
  ["contact", "Your showroom", "Contact, address & hours"],
  ["presentation", "Photographs & visits", "Images, directions & reviews"],
  ["homepage", "Homepage", "Headline & featured cars"],
  ["pages", "Page wording", "Navigation & customer pages"],
  ["services", "Services", "Reservations & feature switches"],
  ["proof", "Why buy from you", "Dealership selling points"],
  ["brochure", "Printed details", "Vehicle print design"],
  ["legal", "Business details", "Company, social & policy links"],
  ["review", "Review & publish", "Check the draft before publishing"],
];

const fallbackSettings: DealerSettings = {
  onlineReservation: { enabled: false, depositPence: 10000, terms: "", ...dealerConfig.onlineReservation },
  identity: {
    name: dealerConfig.identity.name,
    logoText: dealerConfig.identity.logoText || '',
    logoAsset: dealerConfig.identity.logoAsset || '',
    brandColors: {
      primaryHsl: dealerConfig.identity.brandColors?.primaryHsl || '218 39% 16%',
      accentHsl: dealerConfig.identity.brandColors?.accentHsl || '42 82% 49%',
    },
  },
  contact: {
    phone: dealerConfig.contact.phone || '',
    whatsapp: dealerConfig.contact.whatsapp || '',
    email: dealerConfig.contact.email || '',
  },
  address: {
    street: dealerConfig.address?.street || '',
    city: dealerConfig.address?.city || '',
    region: dealerConfig.address?.region || '',
    postcode: dealerConfig.address?.postcode || '',
    mapsUrl: dealerConfig.address?.mapsUrl || '',
  },
  hours: dealerConfig.hours || [],
  legal: {
    companyName: dealerConfig.legal.companyName || '',
    companyNumber: dealerConfig.legal.companyNumber || '',
    vatNumber: dealerConfig.legal.vatNumber || '',
    termsUrl: dealerConfig.legal.termsUrl || '',
    privacyUrl: dealerConfig.legal.privacyUrl || '',
    cookieUrl: dealerConfig.legal.cookieUrl || '',
  },
  social: {
    instagram: dealerConfig.social.instagram || '',
    facebook: dealerConfig.social.facebook || '',
    twitter: dealerConfig.social.twitter || '',
  },
  hero: {
    announcement: dealerConfig.hero.announcement || '',
    copy: dealerConfig.hero.copy,
    subcopy: dealerConfig.hero.subcopy,
    primaryCta: dealerConfig.hero.primaryCta,
    secondaryCta: dealerConfig.hero.secondaryCta,
  },
  featuredVehicleIds: [...(dealerConfig.featuredVehicleIds || [])],
  warranty: {
    enabled: dealerConfig.warranty?.enabled ?? true,
    title: dealerConfig.warranty?.title || 'Warranty',
    description: dealerConfig.warranty?.description || '',
    ctaLabel: dealerConfig.warranty?.ctaLabel || 'Learn more',
  },
  delivery: {
    enabled: dealerConfig.delivery?.enabled ?? true,
    title: dealerConfig.delivery?.title || 'Nationwide delivery',
    description: dealerConfig.delivery?.description || '',
    ctaLabel: dealerConfig.delivery?.ctaLabel || 'Ask about delivery',
  },
  partExchange: {
    enabled: dealerConfig.partExchange?.enabled ?? true,
    title: dealerConfig.partExchange?.title || 'Part exchange',
    description: dealerConfig.partExchange?.description || '',
    ctaLabel: dealerConfig.partExchange?.ctaLabel || 'Value my car',
  },
  bookViewing: {
    title: dealerConfig.bookViewing.title,
    description: dealerConfig.bookViewing.description,
    ctaLabel: dealerConfig.bookViewing.ctaLabel,
  },
  recentHandovers: {
    enabled: dealerConfig.recentHandovers?.enabled ?? false,
    count: dealerConfig.recentHandovers?.count ?? 3,
  },
  trustItems: [...dealerConfig.trustItems],
  whyBuy: (dealerConfig.whyBuy || []).map((item) => ({ ...item })),
};

function copySettings(source: DealerSettings): DealerSettings {
  return {
    identity: { ...source.identity, brandColors: { ...source.identity.brandColors } },
    contact: { ...source.contact },
    address: { ...source.address },
    hours: source.hours.map((item) => ({ ...item })),
    legal: { ...source.legal },
    social: { ...source.social },
    hero: { ...source.hero },
    featuredVehicleIds: [...source.featuredVehicleIds],
    warranty: { ...source.warranty },
    delivery: { ...source.delivery },
    partExchange: { ...source.partExchange },
    onlineReservation: { enabled: false, depositPence: 10000, terms: "", ...source.onlineReservation },
    bookViewing: { ...source.bookViewing },
    recentHandovers: { ...source.recentHandovers },
    presentation: { ...source.presentation, ...(source.presentation?.websiteCopy ? { websiteCopy: { ...source.presentation.websiteCopy } } : {}) },
    brochure: { ...source.brochure },
    trustItems: [...source.trustItems],
    whyBuy: source.whyBuy.map((item) => ({ ...item })),
  };
}

function apiErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return 'The showroom settings could not be saved. Check the fields and try again.';
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>{label}</span>
        {hint && (
          <span className="text-[12px] font-normal text-primary/70">
            {hint}
          </span>
        )}
      </span>
      {children}
      {error && (
        <span className="block text-[12px] font-semibold text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

function SectionCard({
  id,
  eyebrow,
  title,
  description,
  icon,
  children,
}: {
  id: FormSection;
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const active = useContext(ActiveSettingsSection);
  if (active && active !== id) return null;
  return (
    <section tabIndex={-1} id={`settings-${id}`} className="scroll-mt-28 rounded-md border border-border bg-card p-6 shadow-none luxxy-surface sm:p-8">
      <div className="mb-8 flex flex-col items-start gap-4 border-b border-border pb-6 sm:flex-row">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-secondary/20 text-primary">
          {icon}
        </div>
        <div>
          <p className="luxxy-kicker text-primary">{eyebrow}</p>
          <h2 className="mt-2 font-display text-xl font-semibold leading-tight tracking-[-.02em] text-primary">
            {title}
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-primary/70">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ServiceEditor({
  service,
  label,
  icon,
  onChange,
}: {
  service: DealerService;
  label: string;
  icon: ReactNode;
  onChange: (service: DealerService) => void;
}) {
  return (
    <div className={`rounded-md border p-6 transition-colors ${service.enabled ? 'border-primary/30 bg-primary/5' : 'bg-muted/10'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center border border-border bg-background text-primary shadow-none">
            {icon}
          </div>
          <div>
            <p className="text-[13px] font-semibold text-primary">{label}</p>
            <p className="mt-0.5 text-[12px] text-primary/70">
              {service.enabled ? 'Visible on your showroom' : 'Hidden from your showroom'}
            </p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12px] font-medium text-primary/70">
          <input
            type="checkbox"
            checked={service.enabled}
            onChange={(event) => onChange({ ...service, enabled: event.target.checked })}
            className="peer sr-only"
            data-testid={`checkbox-service-${label.toLowerCase().replace(/\s+/g, '-')}`}
          />
          <span className="flex h-6 w-11 items-center rounded-sm bg-muted/60 p-1 transition-colors peer-checked:bg-primary">
            <span className="h-4 w-4 rounded-sm bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
          </span>
          {service.enabled ? 'On' : 'Off'}
        </label>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Field label="Section title">
          <Input value={service.title} onChange={(event) => onChange({ ...service, title: event.target.value })} data-testid={`input-${label.toLowerCase().replace(/\s+/g, '-')}-title`} />
        </Field>
        <Field label="Button label">
          <Input value={service.ctaLabel} onChange={(event) => onChange({ ...service, ctaLabel: event.target.value })} data-testid={`input-${label.toLowerCase().replace(/\s+/g, '-')}-cta`} />
        </Field>
        <Field label="Description" hint="Up to 300 characters">
          <Textarea rows={3} value={service.description} onChange={(event) => onChange({ ...service, description: event.target.value })} data-testid={`textarea-${label.toLowerCase().replace(/\s+/g, '-')}-description`} />
        </Field>
      </div>
    </div>
  );
}

export function DealerSettingsPanel() {
  const { stock } = useStock();
  const stockWithThumbnails = useMemo(() => {
    return (stock?.cars || []).filter((car) => Boolean(getThumbnailUrl(car)));
  }, [stock?.cars]);

  const settingsQuery = useGetDealerSettings({ query: { queryKey: getGetDealerSettingsQueryKey() } });
  const queryClient = useQueryClient();
  const updateSettings = useUpdateDealerSettings();
  const [form, setForm] = useState<DealerSettings>(fallbackSettings);
  const [initialized, setInitialized] = useState(false);
  const [activeSection, setActiveSection] = useState<FormSection>('identity');
  const [guided, setGuided] = useState(true);
  const stepIndex = setupSteps.findIndex(([id]) => id === activeSection);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [draftStored, setDraftStored] = useState(true);
  const dirty = initialized && JSON.stringify(form) !== savedSnapshot;

  useEffect(() => {
    if (settingsQuery.data && !initialized) {
      const saved = copySettings(settingsQuery.data);
      const draft = readSettingsDraft(saved);
      setForm(draft ? copySettings(draft.form) : saved);
      setSavedSnapshot(draft?.saved ?? JSON.stringify(saved));
      setInitialized(true);
    }
  }, [initialized, settingsQuery.data]);

  useEffect(() => {
    if (!initialized) return;
    if (dirty) setDraftStored(writeSettingsDraft(savedSnapshot, form));
    else clearSettingsDraft();
  }, [dirty, form, initialized, savedSnapshot]);

  useEffect(() => {
    if (!dirty || draftStored) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, draftStored]);


  const completeness = useMemo(() => {
    const checks = [
      form.identity.name,
      form.hero.copy,
      form.hero.subcopy,
      form.contact.phone || form.contact.email,
      form.address.city,
      form.trustItems.filter(Boolean).length > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [form]);

  const updateGroup = <K extends keyof DealerSettings>(key: K, value: DealerSettings[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveMessage('');
  };

  const updateNested = <K extends keyof DealerSettings, P extends keyof DealerSettings[K]>(
    group: K,
    property: P,
    value: DealerSettings[K][P],
  ) => {
    setForm((current) => ({
      ...current,
      [group]: { ...(current[group] as object), [property]: value },
    }));
    setSaveMessage('');
  };

  const updatePresentation = (key: keyof DealerPresentation, value: string | boolean) =>
    updateGroup("presentation", { ...form.presentation, [key]: value });

  const validate = () => {
    const errors: Record<string, string> = {};
    if (form.brochure?.accentColour && !/^#[0-9a-fA-F]{6}$/.test(form.brochure.accentColour)) errors['brochure.accentColour'] = 'Use a six-digit colour such as #835b33.';
    if (form.brochure?.photoLimit !== undefined && (!Number.isInteger(form.brochure.photoLimit) || form.brochure.photoLimit < 1 || form.brochure.photoLimit > 80)) errors['brochure.photoLimit'] = 'Choose between 1 and 80 photographs.';
    if (!isValidHsl(form.identity.brandColors.primaryHsl) || !isValidHsl(form.identity.brandColors.accentHsl)) errors['identity.colours'] = 'Use a hue from 0–360 and saturation/lightness from 0–100%, or choose a colour using the picker.';
    for (const [key, value] of Object.entries(form.presentation || {})) {
      if (key.endsWith("Colour") && value && (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))) errors[`presentation.${key}`] = "Use a six-digit hex colour, or leave blank.";
      if (key.endsWith("Url") && typeof value === "string" && value && !/^https:\/\/[^\s]+$/.test(value))
        errors[`presentation.${key}`] =
          "Use a full HTTPS address, or leave this empty.";
    }
    for (const subject of ["hero", "showroom", "team", "visit", "contact", "reception"] as const) {
      if (
        form.presentation?.[`${subject}ImageUrl`] &&
        !form.presentation?.[`${subject}ImageAlt`]?.trim()
      )
        errors[`presentation.${subject}ImageAlt`] =
          "Describe the photograph for customers using a screen reader.";
    }
    for (const [group, fields] of Object.entries({ identity: { logoAsset: form.identity.logoAsset }, contact: { email: '' }, address: { mapsUrl: form.address.mapsUrl }, legal: { termsUrl: form.legal.termsUrl, privacyUrl: form.legal.privacyUrl, cookieUrl: form.legal.cookieUrl }, social: form.social })) {
      for (const [key, value] of Object.entries(fields)) if (value && !/^https?:\/\/[^\s]+$/.test(value)) errors[`${group}.${key}`] = 'Use a full HTTP or HTTPS address.';
    }
    if (form.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact.email)) errors['contact.email'] = 'Enter a valid email address.';
    if (!form.identity.name.trim()) errors['identity.name'] = 'Add the dealership name.';
    if (!form.hero.copy.trim()) errors['hero.copy'] = 'Add a homepage headline.';
    if (!form.hero.subcopy.trim()) errors['hero.subcopy'] = 'Add a short supporting line.';
    if (!form.hero.primaryCta.trim()) errors['hero.primaryCta'] = 'Add a primary button label.';
    if (!form.bookViewing.title.trim()) errors['bookViewing.title'] = 'Add a viewing title.';
    if (!form.bookViewing.description.trim()) errors['bookViewing.description'] = 'Add a viewing description.';
    if (!form.bookViewing.ctaLabel.trim()) errors['bookViewing.ctaLabel'] = 'Add a viewing button label.';
    const reservation = form.onlineReservation;
    if (reservation && (!Number.isInteger(reservation.depositPence) || reservation.depositPence < 100 || reservation.depositPence > 1000000)) errors['onlineReservation.depositPence'] = 'Enter a deposit between £1 and £10,000, in pounds and pence.';
    if (reservation?.enabled && !reservation.terms.trim()) errors['onlineReservation.terms'] = 'Add your reservation terms before enabling online reservations.';
    if (form.hours.some((item) => !item.days.trim() || !item.times.trim())) errors.hours = 'Complete or remove each opening-hours row.';
    if (form.trustItems.some((item) => !item.trim())) errors.trustItems = 'Remove empty trust points or fill them in.';
    if (form.whyBuy.some((item) => !item.title.trim() || !item.description.trim())) errors.whyBuy = 'Complete or remove each why-buy point.';
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      const first = Object.keys(errors)[0];
      if (first.startsWith("brochure")) setActiveSection("brochure");
      else if (/^presentation\.(footerLogoUrl|faviconUrl|.*Colour)$/.test(first)) setActiveSection("identity");
      else if (first.startsWith("presentation")) setActiveSection("presentation");
      else if (first.startsWith('identity')) setActiveSection('identity');
      else if (first.startsWith('hero') || first.startsWith('bookViewing')) setActiveSection('homepage');
      else if (first === 'hours' || first.startsWith('contact') || first.startsWith('address')) setActiveSection('contact');
      else if (first.startsWith('legal') || first.startsWith('social')) setActiveSection('legal');
      else if (first.startsWith('onlineReservation')) setActiveSection('services');
      else setActiveSection('proof');
      return false;
    }
    return true;
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialized || !settingsQuery.data) return;
    setSaveMessage('');
    if (!validate()) return;
    if (guided && activeSection !== 'review') { scrollToSection('review'); return; }
    updateSettings.mutate(
      { data: copySettings(form) },
      {
        onSuccess: (saved) => {
          setForm(copySettings(saved));
          setSavedSnapshot(JSON.stringify(copySettings(saved)));
          clearSettingsDraft();
          setSaveMessage('Published to the showroom. Your changes are live.');
          queryClient.setQueryData(getGetDealerSettingsQueryKey(), saved);
          queryClient.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() });
        },
      },
    );
  };

  const scrollToSection = (section: FormSection) => {
    setActiveSection(section);
    requestAnimationFrame(() => { const panel = document.getElementById(`settings-${section}`); panel?.scrollIntoView({ block: 'start' }); panel?.focus({ preventScroll: true }); });
  };

  const addHour = () => updateGroup('hours', [...form.hours, { days: '', times: '' }]);
  const addTrustItem = () => {
    if (form.trustItems.length < 8) updateGroup('trustItems', [...form.trustItems, '']);
  };
  const addWhyBuy = () => {
    if (form.whyBuy.length < 8) updateGroup('whyBuy', [...form.whyBuy, { title: '', description: '' }]);
  };
  const addFeatured = (id: string) => {
    if (!id || form.featuredVehicleIds.includes(id) || form.featuredVehicleIds.length >= 8) return;
    updateGroup('featuredVehicleIds', [...form.featuredVehicleIds, id]);
  };
  const removeFeatured = (index: number) => {
    const next = [...form.featuredVehicleIds];
    next.splice(index, 1);
    updateGroup('featuredVehicleIds', next);
  };
  const moveFeatured = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === form.featuredVehicleIds.length - 1) return;
    const next = [...form.featuredVehicleIds];
    const swap = direction === 'up' ? index - 1 : index + 1;
    [next[index], next[swap]] = [next[swap], next[index]];
    updateGroup('featuredVehicleIds', next);
  };

  if (settingsQuery.isError && !initialized) {
    return (
      <section role="alert" className="border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive" data-testid="status-settings-load-error">
        <h2 className="font-display text-xl font-semibold">Could not load showroom settings</h2>
        <p className="mt-2">Your published settings must load before you can edit them. Any draft in this browser tab is still saved.</p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => void settingsQuery.refetch()} disabled={settingsQuery.isFetching}>
          {settingsQuery.isFetching ? 'Retrying…' : 'Try again'}
        </Button>
      </section>
    );
  }

  if (!initialized) {
    return (
      <section className="mb-12 rounded-md border border-border bg-card p-6 shadow-none luxxy-surface sm:p-8" data-testid="settings-loading">
        <div className="animate-pulse space-y-5">
          <div className="h-5 w-44 bg-muted/40" />
          <div className="h-10 w-72 bg-muted/40" />
          <div className="h-28 bg-muted/40" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-12 bg-muted/40" />
            <div className="h-12 bg-muted/40" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-studio mb-12" aria-labelledby="settings-heading">
      <div className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="luxxy-kicker text-primary">
            <Store className="h-3.5 w-3.5" /> Showroom settings</p>
          <h2 id="settings-heading" className="mt-3 font-display text-2xl font-semibold leading-tight tracking-tight text-primary">Make this website yours.</h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-primary/70">
            Set up your dealership: branding, contact details, photographs,
            visiting information and services. Publish when the information is
            ready for customers.
          </p>
        </div>
        <div className="flex items-center gap-4 border border-border bg-card px-5 py-4 shadow-none luxxy-surface">
          <p className="text-sm text-muted-foreground">
            Basic profile fields{" "}
            <span className="ml-2 font-semibold tabular-nums text-primary">
              {Math.round(completeness * 6 / 100)} of 6
            </span>
          </p>
        </div>
      </div>

      <div className="settings-setup-bar">
        <div><p className="text-sm font-semibold">{guided ? `Step ${stepIndex + 1} of ${setupSteps.length} · ${setupSteps[stepIndex][1]}` : 'All website settings'}</p><p className="mt-1 text-xs text-muted-foreground">Your draft is private until you publish. You can move between sections at any time.</p></div>
        <Button type="button" variant="outline" onClick={() => setGuided(!guided)}>{guided ? 'Show all sections' : 'Use step-by-step setup'}</Button>
      </div>

      {settingsQuery.isError && (
        <div className="mb-8 flex items-start gap-4 border border-amber-500/30 bg-amber-50/50 p-5 text-[13px] text-amber-900" data-testid="status-settings-load-error">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-bold">Could not refresh showroom settings</p>
            <p className="mt-1.5 leading-relaxed text-amber-900/80">Your draft and the last loaded settings are still here. Retry to check for more recent changes before publishing.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void settingsQuery.refetch()} disabled={settingsQuery.isFetching}>
              {settingsQuery.isFetching ? 'Retrying…' : 'Try again'}
            </Button>
          </div>
        </div>
      )}

      <div className="settings-workspace">
      <nav className="settings-step-nav" aria-label="Settings sections">
        {setupSteps.map(([section, label, hint], index) => <button key={section} type="button" aria-current={activeSection === section ? 'step' : undefined} onClick={() => scrollToSection(section)} data-testid={`button-settings-nav-${section}`}>
          <span className="settings-step-number">{String(index + 1).padStart(2, '0')}</span><span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span></span>
        </button>)}
      </nav>

      {dirty && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-accent bg-secondary/40 px-4 py-3" role="status">
          <div className="text-sm">
            <p className="font-semibold">Unpublished changes</p>
            <p className="mt-1 text-muted-foreground">{draftStored ? 'Your draft stays in this browser tab for 24 hours, including when you view the published showroom.' : 'Your draft stays while this app is open. Browser storage is unavailable; keep this tab open until you publish.'}</p>
            {settingsQuery.data && savedSnapshot !== JSON.stringify(copySettings(settingsQuery.data)) && <p className="mt-1">Published settings have changed since this draft started. Check them before publishing your draft.</p>}
          </div>
          <Button type="button" variant="outline" onClick={() => {
            if (!window.confirm('Discard your unpublished showroom changes?')) return;
            const saved = copySettings(settingsQuery.data ?? fallbackSettings);
            setForm(saved);
            setSavedSnapshot(JSON.stringify(saved));
            setValidationErrors({});
            setSaveMessage('');
            clearSettingsDraft();
          }}>Discard draft</Button>
        </div>
      )}
      <ActiveSettingsSection.Provider value={guided ? activeSection : null}>
      <form onSubmit={save} data-preserves-draft="true" className="settings-editor space-y-6" noValidate>
        <SectionCard id="identity" eyebrow="Brand" title="Brand identity" description="This is the name, mark and colour language customers will recognise across your site." icon={<Palette className="h-5 w-5" />}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Dealership name" error={validationErrors['identity.name']}>
              <Input required className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.identity.name} onChange={(event) => updateNested('identity', 'name', event.target.value)} data-testid="input-identity-name" />
            </Field>
            <Field label="Logo text" hint="Shown when no image is set">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.identity.logoText} onChange={(event) => updateNested('identity', 'logoText', event.target.value)} data-testid="input-identity-logo-text" />
            </Field>
            <Field label="Logo image URL" hint="Optional">
              <div className="relative">
                <Image className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                <Input className="h-11 rounded-md pl-10 text-base focus-visible:border-accent" type="url" value={form.identity.logoAsset} onChange={(event) => updateNested('identity', 'logoAsset', event.target.value)} placeholder="https://…" data-testid="input-identity-logo-asset" />
              </div>
            </Field>
            {([['footerLogoUrl', 'Logo for the dark footer'], ['faviconUrl', 'Browser-tab icon']] as const).map(([key, label]) => <Field key={key} label={label} hint="Optional HTTPS image URL" error={validationErrors[`presentation.${key}`]}><Input type="url" maxLength={2048} value={form.presentation?.[key] || ''} onChange={event => updatePresentation(key, event.target.value)} data-testid={`input-${key}`} /></Field>)}
            <details className="sm:col-span-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Advanced design settings</summary><p className="mb-4 text-xs text-muted-foreground">Optional brand colour overrides. The defaults are ready to use.</p>            <div className="grid gap-4 sm:grid-cols-2">
              <ColourField label="Primary colour" value={form.identity.brandColors.primaryHsl} onChange={(primaryHsl) => updateNested('identity', 'brandColors', { ...form.identity.brandColors, primaryHsl })} testId="input-brand-primary" />
              <ColourField label="Accent colour" value={form.identity.brandColors.accentHsl} onChange={(accentHsl) => updateNested('identity', 'brandColors', { ...form.identity.brandColors, accentHsl })} testId="input-brand-accent" />
            </div></details>
            <details className="sm:col-span-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Page and text colours</summary><p className="mb-4 text-xs text-muted-foreground">Keep text dark enough to read on your chosen backgrounds. Blank values retain the neutral design.</p><div className="grid gap-4 sm:grid-cols-2">{([['pageColour', 'Page background', '#f6f6f5'], ['panelColour', 'Cards and forms', '#ffffff'], ['headingColour', 'Headings and prices', '#202428'], ['linkColour', 'Links and accents', '#254e77']] as const).map(([key, label, fallback]) => <Field key={key} label={label} error={validationErrors[`presentation.${key}`]}><div className="flex gap-2"><input aria-label={`${label} colour picker`} type="color" value={form.presentation?.[key] || fallback} onChange={event => updatePresentation(key, event.target.value)} className="h-11 w-14" /><Input aria-label={`${label} hex value`} value={form.presentation?.[key] || ''} placeholder={fallback} maxLength={7} onChange={event => updatePresentation(key, event.target.value)} /></div></Field>)}</div></details>
            {validationErrors['identity.colours'] && <p role="alert" className="text-sm text-destructive sm:col-span-2">{validationErrors['identity.colours']}</p>}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4 border border-border bg-secondary/15 p-5">
            <DealerWordmark {...form.identity} />
            <div className="h-10 w-10 border border-border/50" style={{ backgroundColor: `hsl(${form.identity.brandColors.primaryHsl})` }} />
            <div className="h-10 w-10 border border-border/50" style={{ backgroundColor: `hsl(${form.identity.brandColors.accentHsl})` }} />
            <p className="text-[12px] text-primary/70">
              Colour preview. Choose colours with enough contrast for clear text and controls.
            </p>
          </div>
        </SectionCard>

        <SectionCard id="contact" eyebrow="Visit" title="Contact and opening hours" description="Give shoppers the details they need to call, message or find the forecourt with confidence." icon={<MapPin className="h-5 w-5" />}>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Phone">
              <Input type="tel" className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.contact.phone} onChange={(event) => updateNested('contact', 'phone', event.target.value)} data-testid="input-contact-phone" />
            </Field>
            <Field label="WhatsApp">
              <Input type="tel" className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.contact.whatsapp} onChange={(event) => updateNested('contact', 'whatsapp', event.target.value)} data-testid="input-contact-whatsapp" />
            </Field>
            <Field label="Email">
              <Input type="email" className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.contact.email} onChange={(event) => updateNested('contact', 'email', event.target.value)} data-testid="input-contact-email" />
            </Field>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <Field label="Street address">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.address.street} onChange={(event) => updateNested('address', 'street', event.target.value)} data-testid="input-address-street" />
            </Field>
            <Field label="Town / city">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.address.city} onChange={(event) => updateNested('address', 'city', event.target.value)} data-testid="input-address-city" />
            </Field>
            <Field label="Region">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.address.region} onChange={(event) => updateNested('address', 'region', event.target.value)} data-testid="input-address-region" />
            </Field>
            <Field label="Postcode">
              <Input className="h-11 rounded-md font-mono text-base focus-visible:border-accent" value={form.address.postcode} onChange={(event) => updateNested('address', 'postcode', event.target.value)} data-testid="input-address-postcode" />
            </Field>
            <Field label="Google Maps link" hint="Optional">
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                <Input className="h-11 rounded-md pl-10 text-base focus-visible:border-accent" type="url" value={form.address.mapsUrl} onChange={(event) => updateNested('address', 'mapsUrl', event.target.value)} placeholder="https://maps.google.com/…" data-testid="input-address-maps" />
              </div>
            </Field>
          </div>
          <div className="mt-8 border border-border bg-secondary/10 p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 font-display text-[1.25rem] font-semibold tracking-[-.02em] text-primary">
                  <Clock3 className="h-4 w-4 text-accent" /> Opening hours</p>
                <p className="mt-1 text-[13px] text-primary/70">Add the hours exactly as you want them shown publicly.</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="rounded-md text-[12px] font-medium shadow-none" onClick={addHour} disabled={form.hours.length >= 14} data-testid="button-add-hours">
                <Plus className="mr-2 h-4 w-4" /> Add row</Button>
            </div>
            <div className="space-y-4">
              {form.hours.map((item, index) => (
                <div key={`hour-${index}`} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={item.days} onChange={(event) => { const hours = [...form.hours]; hours[index] = { ...item, days: event.target.value }; updateGroup('hours', hours); }} placeholder="Monday – Friday" data-testid={`input-hours-days-${index}`} />
                  <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={item.times} onChange={(event) => { const hours = [...form.hours]; hours[index] = { ...item, times: event.target.value }; updateGroup('hours', hours); }} placeholder="09:00 – 18:00" data-testid={`input-hours-times-${index}`} />
                  <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0 rounded-md hover:bg-destructive/10 hover:text-destructive" onClick={() => updateGroup('hours', form.hours.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove hours row ${index + 1}`} data-testid={`button-remove-hours-${index}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {form.hours.length === 0 && (
                <p className="border border-dashed border-border p-6 text-center text-[13px] text-primary/70">No opening hours added yet.</p>
              )}
            </div>
            {validationErrors.hours && (
              <p className="mt-3 text-[12px] font-semibold text-destructive">
                {validationErrors.hours}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard id="homepage" eyebrow="First impression" title="Homepage content" description="Shape the first few seconds of the showroom: your announcement, headline, supporting line and calls to action." icon={<Store className="h-5 w-5" />}>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">{([['featuredEnabled', 'Show featured cars', true], ['visitEnabled', 'Show visit and dealership section', true], ['servicesEnabled', 'Show services section', true], ['showHeroDescription', 'Show introduction below hero headline', false]] as const).map(([key, label, fallback]) => <label key={key} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={form.presentation?.[key] ?? fallback} onChange={event => updatePresentation(key, event.target.checked)} />{label}</label>)}</div>
          <div className="grid gap-5">
            <Field label="Announcement strip" hint="Optional">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.hero.announcement} onChange={(event) => updateNested('hero', 'announcement', event.target.value)} placeholder="New stock added this week" data-testid="input-hero-announcement" />
            </Field>
            <Field label="Homepage headline" error={validationErrors['hero.copy']}>
              <Input required className="h-11 rounded-md font-display text-[15px] font-semibold focus-visible:border-accent" value={form.hero.copy} onChange={(event) => updateNested('hero', 'copy', event.target.value)} data-testid="input-hero-copy" />
            </Field>
            <Field label="Dealership introduction" hint="Used in the footer. Optionally show it below the homepage headline too." error={validationErrors['hero.subcopy']}>
              <Textarea required rows={3} className="rounded-md text-base focus-visible:border-accent" value={form.hero.subcopy} onChange={(event) => updateNested('hero', 'subcopy', event.target.value)} data-testid="textarea-hero-subcopy" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Browse cars button" error={validationErrors['hero.primaryCta']}>
                <Input required className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.hero.primaryCta} onChange={(event) => updateNested('hero', 'primaryCta', event.target.value)} data-testid="input-hero-primary-cta" />
              </Field>
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-8">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 font-display text-[1.25rem] font-semibold tracking-[-.02em] text-primary">
                  <Image className="h-4 w-4 text-accent" /> Featured vehicles</p>
                <p className="mt-1 text-[13px] leading-relaxed text-primary/70">Select up to 8 vehicles to lead the stock list. These selections do not change your homepage photograph. Choose that separately in Photos & visit.</p>
              </div>
            </div>

            <div className="space-y-3">
              {form.featuredVehicleIds.map((id, index) => {
                const car = stock?.cars.find(c => c.id === id);
                const thumb = car ? getThumbnailUrl(car) : null;
                const isStale = !car;

                return (
                  <div key={`${id}-${index}`} className="flex items-center justify-between gap-4 border border-border bg-card p-2 pr-4 transition-colors" data-testid={`featured-vehicle-${index}`}>
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="relative h-12 w-16 shrink-0 bg-secondary/20">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-primary/70">
                            <Image className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 truncate">
                        <p className="truncate text-[13px] font-semibold text-foreground">
                          {car ? vehicleDisplayTitle(car) : `Unknown vehicle (${id})`}
                        </p>
                        <p className="truncate text-[12px] text-primary/70">
                          {car && car.price
                            ? formatPrice(car.price, car.currency)
                            : isStale ? 'Sold or removed' : 'Needs a photo to be featured'}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-md hover:bg-secondary" onClick={() => moveFeatured(index, 'up')} disabled={index === 0} aria-label={`Move ${car ? vehicleDisplayTitle(car) : 'vehicle'} up`} data-testid={`button-featured-up-${index}`}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-md hover:bg-secondary" onClick={() => moveFeatured(index, 'down')} disabled={index === form.featuredVehicleIds.length - 1} aria-label={`Move ${car ? vehicleDisplayTitle(car) : 'vehicle'} down`} data-testid={`button-featured-down-${index}`}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <div className="mx-1 h-4 w-px bg-border/60" />
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-md hover:bg-destructive/10 hover:text-destructive" onClick={() => removeFeatured(index)} aria-label={`Remove ${car ? vehicleDisplayTitle(car) : 'vehicle'}`} data-testid={`button-featured-remove-${index}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {form.featuredVehicleIds.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-border bg-secondary/10 p-8 text-center" data-testid="featured-empty-state">
                  <Image className="h-5 w-5 text-primary/70/60" />
                  <p className="text-[13px] font-semibold text-primary">No vehicles selected</p>
                  <p className="text-[12px] text-primary/70">The most recent stock with photos will be shown instead.</p>
                </div>
              )}

              {form.featuredVehicleIds.length < 8 && stockWithThumbnails.length > 0 && (
                  <div className="mt-4 flex items-center gap-3 border border-border bg-secondary/10 p-3">
                    <select
                    className="h-9 w-full flex-1 rounded-md border border-transparent bg-background px-3 text-[13px] focus-visible:ring-2 focus-visible:ring-ring"
                    value=""
                    onChange={(e) => addFeatured(e.target.value)}
                    data-testid="select-featured-vehicle"
                    aria-label="Add a vehicle to feature"
                  >
                      <option value="" disabled>Add a featured vehicle ({8 - form.featuredVehicleIds.length} remaining)...</option>
                      {stockWithThumbnails
                      .filter((c) => !form.featuredVehicleIds.includes(c.id))
                      .map((c) => (
                          <option key={c.id} value={c.id}>
                            {vehicleDisplayTitle(c)} •{" "}
                            {c.price ? formatPrice(c.price, c.currency) : 'POA'}{" "}
                            • {c.registration || 'No reg'}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-8">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 font-display text-[1.25rem] font-semibold tracking-[-.02em] text-primary">
                  <Check className="h-4 w-4 text-accent" /> Recent handovers</p>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-primary/70">Show a small, anonymised list of completed handovers. No buyer, price, registration or transaction details are published.</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 text-[12px] font-medium text-primary/70">
                <input
                  type="checkbox"
                  checked={form.recentHandovers.enabled}
                  onChange={(event) => updateNested('recentHandovers', 'enabled', event.target.checked)}
                  className="peer sr-only"
                  data-testid="checkbox-recent-handovers"
                />
                <span className="flex h-6 w-11 items-center rounded-sm bg-muted/60 p-1 transition-colors peer-checked:bg-primary">
                  <span className="h-4 w-4 rounded-sm bg-background shadow-sm transition-transform peer-checked:translate-x-5" />
                </span>
                {form.recentHandovers.enabled ? 'On' : 'Off'}
              </label>
            </div>
            <div className="max-w-xs">
              <Field label="Handovers to show" hint="1–6 items">
                <Input
                  type="number"
                  min={1}
                  max={6}
                  step={1}
                  value={form.recentHandovers.count}
                  onChange={(event) => updateNested('recentHandovers', 'count', Math.min(6, Math.max(1, Number(event.target.value) || 1)))}
                  data-testid="input-recent-handovers-count"
                />
              </Field>
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-8">
            <p className="mb-5 font-display text-[14px] font-semibold tracking-normal text-primary">Viewing invitation</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Title" error={validationErrors['bookViewing.title']}>
                <Input required className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.bookViewing.title} onChange={(event) => updateNested('bookViewing', 'title', event.target.value)} data-testid="input-viewing-title" />
              </Field>
              <Field label="Button label" error={validationErrors['bookViewing.ctaLabel']}>
                <Input required className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.bookViewing.ctaLabel} onChange={(event) => updateNested('bookViewing', 'ctaLabel', event.target.value)} data-testid="input-viewing-cta" />
              </Field>
              <Field label="Description" error={validationErrors['bookViewing.description']}>
                <Textarea required rows={3} className="rounded-md text-base focus-visible:border-accent" value={form.bookViewing.description} onChange={(event) => updateNested('bookViewing', 'description', event.target.value)} data-testid="textarea-viewing-description" />
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="presentation"
          eyebrow="Photography & visits"
          title="Make the dealership your own"
          description="Add genuine dealership photos, practical visiting details and your customer-review page. Leave anything unconfirmed empty."
          icon={<Image className="h-5 w-5" />}
        >
          <div className="space-y-6">
            {(["hero", "showroom", "team", "visit", "contact", "reception"] as const).map((subject) => (
              <div key={subject} className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={`${subject === "hero" ? "Homepage" : subject === "team" ? "Team" : subject === "visit" ? "Visit / forecourt" : subject === "contact" ? "Contact page" : subject === "reception" ? "Reception" : "Showroom"} photograph URL`}
                  hint={subject === "hero" ? "HTTPS · independent of featured stock; use a landscape photograph with the whole car in frame" : subject === "showroom" ? "HTTPS · beside the dealership introduction; leave blank to omit the showroom photo" : "HTTPS"}
                  error={validationErrors[`presentation.${subject}ImageUrl`]}
                >
                  <Input
                    type="url"
                    maxLength={2048}
                    value={form.presentation?.[`${subject}ImageUrl`] || ""}
                    onChange={(event) =>
                      updatePresentation(
                        `${subject}ImageUrl`,
                        event.target.value,
                      )
                    }
                    data-testid={`input-${subject}-image-url`}
                    placeholder="https://…"
                  />
                </Field>
                <Field
                  label={`${subject === "hero" ? "Homepage" : subject === "team" ? "Team" : subject === "visit" ? "Visit / forecourt" : subject === "contact" ? "Contact page" : subject === "reception" ? "Reception" : "Showroom"} photograph description`}
                  error={validationErrors[`presentation.${subject}ImageAlt`]}
                >
                  <Input
                    maxLength={200}
                    value={form.presentation?.[`${subject}ImageAlt`] || ""}
                    onChange={(event) =>
                      updatePresentation(
                        `${subject}ImageAlt`,
                        event.target.value,
                      )
                    }
                    data-testid={`input-${subject}-image-alt`}
                  />
                </Field>
                {form.presentation?.[`${subject}ImageUrl`]?.startsWith('https://') && <ShowroomPhoto src={form.presentation[`${subject}ImageUrl`]!} alt={form.presentation[`${subject}ImageAlt`] || `${subject} photo preview`} className="aspect-video max-w-sm sm:col-span-2" />}
              </div>
            ))}
            <Field label="Homepage photo focus" hint="Choose which part stays in view when the image is cropped"><select className="h-11 w-full rounded border border-input bg-card px-3" value={form.presentation?.heroImagePosition || 'center'} onChange={event => updatePresentation('heroImagePosition', event.target.value)}>{['center', 'left', 'right', 'top', 'bottom'].map(position => <option key={position} value={position}>{position[0].toUpperCase() + position.slice(1)}</option>)}</select></Field>
            <p className="text-sm leading-6 text-muted-foreground">Use a hosted HTTPS image address. Uploading files directly is not available in this installation. Use a transparent PNG or SVG logo and a wide, clear homepage photograph. Stock photos are managed by your stock feed.</p>
            <p className="border-l-2 border-accent pl-4 text-sm leading-6 text-muted-foreground">
              For stock photography, start with a clear front three-quarter
              view, followed by exterior, cabin, boot, wheels and condition
              details. Use consistent lighting and framing. The gallery groups
              captioned images automatically. Your first featured vehicle is
              used when no homepage photograph is set.
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              {(
                [
                  ["teamIntroduction", "Team introduction"],
                  ["visitInstructions", "Appointments & visiting"],
                  ["parkingInstructions", "Parking & arrival instructions"],
                  ["includedInformation", "Buying & handover information"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Textarea
                    maxLength={1000}
                    rows={3}
                    value={form.presentation?.[key] || ""}
                    onChange={(event) =>
                      updatePresentation(key, event.target.value)
                    }
                    data-testid={`input-${key}`}
                  />
                </Field>
              ))}
              <Field
                label="Customer-review page"
                hint="Link to genuine reviews"
                error={validationErrors["presentation.reviewsUrl"]}
              >
                <Input
                  type="url"
                  maxLength={2048}
                  value={form.presentation?.reviewsUrl || ""}
                  onChange={(event) =>
                    updatePresentation("reviewsUrl", event.target.value)
                  }
                  data-testid="input-reviews-url"
                  placeholder="https://…"
                />
              </Field>
            </div>
            <ReviewsSettings value={form.presentation} onChange={value => updateGroup("presentation", value)} />
            <details className="border-y border-border py-3 text-sm">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Vehicle photography guide</summary>
              <ol className="ml-5 mt-3 list-decimal space-y-2 leading-6 text-muted-foreground">
                <li>Use a front three-quarter view for the first photo. Keep the whole car and its wheels in frame, with similar space around each vehicle.</li>
                <li>Choose a clean, uncluttered location and soft daylight. Keep the camera level and use the same background and angle across your stock.</li>
                <li>Photograph all sides, the cabin, dashboard, boot, wheels, keys and relevant service records. Include clear close-ups of any wear or damage.</li>
                <li>Use sharp landscape originals. Avoid heavy filters, text overlays or editing that hides the vehicle’s condition.</li>
              </ol>
            </details>
            <p className="text-sm leading-6 text-muted-foreground">
              Vehicle-specific history, MOT, keys, condition and warranty come
              from each stock record. Dealership-wide wording here does not mark
              individual cars as checked or covered.
            </p>
          </div>
        </SectionCard>

        <SectionCard id="brochure" eyebrow="Customer downloads" title="Vehicle brochure" description="A printed companion to each car. Your dealership name, address and contact details come from Identity and Contact & hours. Vehicle facts and supplied insurance history are always included." icon={<FileText className="h-5 w-5" />}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Brochure cover heading" hint="Up to 60 characters"><Input maxLength={60} value={form.brochure?.title ?? ''} placeholder="Your next car, in detail" onChange={e=>updateGroup('brochure',{...form.brochure,title:e.target.value})} /></Field>

            <Field label="Showroom introduction" hint="Up to 300 characters"><Textarea maxLength={300} rows={3} value={form.brochure?.introduction ?? ''} placeholder="A short invitation to visit or speak to your team." onChange={e=>updateGroup('brochure',{...form.brochure,introduction:e.target.value})} /></Field>
            <Field label="Closing note" hint="Up to 500 characters"><Textarea maxLength={500} rows={3} value={form.brochure?.footerNote ?? ''} placeholder="Your appointment instructions or other useful information." onChange={e=>updateGroup('brochure',{...form.brochure,footerNote:e.target.value})} /></Field>
            <details className="sm:col-span-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Advanced brochure design</summary><div className="grid gap-5 sm:grid-cols-2">
            <Field label="Brochure accent colour" hint="Rules and decorative details" error={validationErrors['brochure.accentColour']}><Input type="color" className="h-11 w-full" value={form.brochure?.accentColour ?? '#835b33'} onChange={e=>updateGroup('brochure',{...form.brochure,accentColour:e.target.value})} /></Field>
            <Field label="Photo layout"><select className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.brochure?.galleryLayout ?? 'grid'} onChange={e=>updateGroup('brochure',{...form.brochure,galleryLayout:e.target.value as 'grid'|'large'})}><option value="grid">Gallery - four photos per page</option><option value="large">Large photos - two per page</option></select></Field>
            <Field label="Maximum photos" hint="Includes the cover photo" error={validationErrors['brochure.photoLimit']}><Input type="number" min={1} max={80} step={1} value={form.brochure?.photoLimit ?? 12} onChange={e=>updateGroup('brochure',{...form.brochure,photoLimit:Number(e.target.value)})} /></Field>
            </div></details>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">{([['includeDescription','Include vehicle description'],['includeFeatures','Include features and equipment'],['includeGallery','Include photo gallery']] as const).map(([key,label])=><label key={key} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.brochure?.[key] !== false} onChange={e=>updateGroup('brochure',{...form.brochure,[key]:e.target.checked})} />{label}</label>)}</div>
          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-border pt-5"><p className="max-w-lg text-sm text-muted-foreground">Publish your settings, then open a brochure to check the final PDF. Previously downloaded copies will keep their original design.</p>{stock?.cars[0] && <a className="text-link min-h-11 text-sm" href={`/api/vehicles/${encodeURIComponent(stock.cars[0].id)}/brochure.pdf`} target="_blank" rel="noopener noreferrer">Open saved brochure <ExternalLink className="h-4 w-4" /><span className="sr-only"> (opens in a new tab)</span></a>}</div>
        </SectionCard>

        <SectionCard id="services" eyebrow="Offer" title="Services" description="Turn customer-facing services on or off, then make the wording sound like your team." icon={<Truck className="h-5 w-5" />}>
          <label className="mb-6 flex items-start gap-3 border-b border-border pb-5"><input type="checkbox" className="mt-1 h-5 w-5" checked={form.presentation?.comparisonEnabled ?? false} onChange={event => updatePresentation('comparisonEnabled', event.target.checked)} data-testid="checkbox-vehicle-comparison" /><span><span className="block text-sm font-semibold">Vehicle comparison</span><span className="mt-1 block text-sm text-muted-foreground">Optional. Allow customers to compare two cars side by side. Saved cars remain available when this is off.</span></span></label>
          <div className="grid gap-5">
            <ServiceEditor label="Warranty" service={form.warranty} icon={<Check className="h-5 w-5" />} onChange={(service) => updateGroup('warranty', service)} />
            <ServiceEditor label="Nationwide delivery" service={form.delivery} icon={<Truck className="h-5 w-5" />} onChange={(service) => updateGroup('delivery', service)} />
            <ServiceEditor label="Part exchange" service={form.partExchange} icon={<Store className="h-5 w-5" />} onChange={(service) => updateGroup('partExchange', service)} />
            <div className="rounded-md border border-border p-6" data-testid="settings-online-reservation">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl">
                  <h3 className="font-semibold">Reserve car online</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Let customers reserve an available car with their contact details and your reservation terms. Completed reservations hold the car and appear in the staff portal.</p>
                </div>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
                  <input type="checkbox" className="h-5 w-5 accent-primary" checked={form.onlineReservation?.enabled ?? false} onChange={(event) => updateGroup('onlineReservation', { enabled: event.target.checked, depositPence: form.onlineReservation?.depositPence ?? 10000, terms: form.onlineReservation?.terms ?? '' })} data-testid="checkbox-online-reservation-enabled" />
                  Enable online reservations
                </label>
              </div>
              <p className="mt-4 border-l-2 border-accent pl-3 text-sm leading-6 text-muted-foreground">Payment is currently simulated. Reservations are real, but no money is collected or recorded as received. Switching this off prevents new online reservations; existing reservations remain in the portal.</p>
              <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,12rem)_1fr]">
                <Field label="Reservation deposit (£)" hint="£1–£10,000" error={validationErrors['onlineReservation.depositPence']}>
                  <Input type="number" inputMode="decimal" min={1} max={10000} step="0.01" value={(form.onlineReservation?.depositPence ?? 10000) / 100} onChange={(event) => updateGroup('onlineReservation', { enabled: form.onlineReservation?.enabled ?? false, terms: form.onlineReservation?.terms ?? '', depositPence: Math.round(Number(event.target.value) * 100) })} data-testid="input-online-reservation-deposit" />
                </Field>
                <Field label="Reservation terms" hint="Required when enabled" error={validationErrors['onlineReservation.terms']}>
                  <Textarea rows={5} maxLength={4000} value={form.onlineReservation?.terms ?? ''} onChange={(event) => updateGroup('onlineReservation', { enabled: form.onlineReservation?.enabled ?? false, depositPence: form.onlineReservation?.depositPence ?? 10000, terms: event.target.value })} placeholder="Explain how long you hold a vehicle, what happens next and your cancellation and refund arrangements." data-testid="textarea-online-reservation-terms" />
                </Field>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard id="proof" eyebrow="Confidence" title="Trust and dealership information" description="Short, specific proof points help customers decide to make the call or book the viewing." icon={<Check className="h-5 w-5" />}>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[14px] font-bold text-primary">Trust points</p>
                  <p className="mt-1 text-[13px] text-primary/70">A compact strip of promises near the stock.</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="rounded-md text-[12px] font-medium shadow-none" onClick={addTrustItem} disabled={form.trustItems.length >= 8} data-testid="button-add-trust-item">
                  <Plus className="mr-2 h-4 w-4" /> Add
                </Button>
              </div>
              <div className="space-y-3">
                {form.trustItems.map((item, index) => (
                  <div key={`trust-${index}`} className="flex gap-3">
                    <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={item} onChange={(event) => { const items = [...form.trustItems]; items[index] = event.target.value; updateGroup('trustItems', items); }} placeholder="Carefully selected vehicles" data-testid={`input-trust-item-${index}`} />
                    <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0 rounded-md hover:bg-destructive/10 hover:text-destructive" onClick={() => updateGroup('trustItems', form.trustItems.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove trust point ${index + 1}`} data-testid={`button-remove-trust-item-${index}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {validationErrors.trustItems && (
                <p className="mt-3 text-[12px] font-semibold text-destructive">
                  {validationErrors.trustItems}
                </p>
              )}
            </div>
            <div>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[14px] font-bold text-primary">Why buy from us</p>
                  <p className="mt-1 text-[13px] text-primary/70">Up to eight fuller reasons for the about section.</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="rounded-md text-[12px] font-medium shadow-none" onClick={addWhyBuy} disabled={form.whyBuy.length >= 8} data-testid="button-add-why-buy">
                  <Plus className="mr-2 h-4 w-4" /> Add
                </Button>
              </div>
              <div className="space-y-4">
                {form.whyBuy.map((item, index) => (
                  <div key={`why-${index}`} className="border border-border bg-secondary/10 p-4">
                    <div className="flex gap-3">
                      <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={item.title} onChange={(event) => { const items = [...form.whyBuy]; items[index] = { ...item, title: event.target.value }; updateGroup('whyBuy', items); }} placeholder="Straightforward buying" data-testid={`input-why-buy-title-${index}`} />
                      <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0 rounded-md hover:bg-destructive/10 hover:text-destructive" onClick={() => updateGroup('whyBuy', form.whyBuy.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove why buy point ${index + 1}`} data-testid={`button-remove-why-buy-${index}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea className="mt-3 rounded-md text-base focus-visible:border-accent" rows={2} value={item.description} onChange={(event) => { const items = [...form.whyBuy]; items[index] = { ...item, description: event.target.value }; updateGroup('whyBuy', items); }} placeholder="Clear information and no surprises." data-testid={`textarea-why-buy-description-${index}`} />
                  </div>
                ))}
              </div>
              {validationErrors.whyBuy && (
                <p className="mt-3 text-[12px] font-semibold text-destructive">
                  {validationErrors.whyBuy}
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard id="legal" eyebrow="Details" title="Social and company details" description="Keep social profiles and company details in one place so the footer stays current." icon={<ExternalLink className="h-5 w-5" />}>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Instagram">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" type="url" value={form.social.instagram} onChange={(event) => updateNested('social', 'instagram', event.target.value)} placeholder="https://instagram.com/…" data-testid="input-social-instagram" />
            </Field>
            <Field label="Facebook">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" type="url" value={form.social.facebook} onChange={(event) => updateNested('social', 'facebook', event.target.value)} placeholder="https://facebook.com/…" data-testid="input-social-facebook" />
            </Field>
            <Field label="X / Twitter">
              <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" type="url" value={form.social.twitter} onChange={(event) => updateNested('social', 'twitter', event.target.value)} placeholder="https://x.com/…" data-testid="input-social-twitter" />
            </Field>
          </div>
          <div className="mt-8 border-t border-border pt-8">
            <p className="mb-5 font-display text-[14px] font-semibold tracking-normal text-primary">Company and policy links</p>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Registered company name">
                <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.legal.companyName} onChange={(event) => updateNested('legal', 'companyName', event.target.value)} data-testid="input-legal-company-name" />
              </Field>
              <Field label="Company number">
                <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.legal.companyNumber} onChange={(event) => updateNested('legal', 'companyNumber', event.target.value)} data-testid="input-legal-company-number" />
              </Field>
              <Field label="VAT number">
                <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" value={form.legal.vatNumber} onChange={(event) => updateNested('legal', 'vatNumber', event.target.value)} data-testid="input-legal-vat-number" />
              </Field>
              <Field label="Terms link">
                <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" type="url" value={form.legal.termsUrl} onChange={(event) => updateNested('legal', 'termsUrl', event.target.value)} data-testid="input-legal-terms" />
              </Field>
              <Field label="Privacy link">
                <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" type="url" value={form.legal.privacyUrl} onChange={(event) => updateNested('legal', 'privacyUrl', event.target.value)} data-testid="input-legal-privacy" />
              </Field>
              <Field label="Cookie link">
                <Input className="h-12 w-full rounded-md border border-border bg-card px-4 font-medium text-base text-primary shadow-none transition-all focus-visible:border-accent" type="url" value={form.legal.cookieUrl} onChange={(event) => updateNested('legal', 'cookieUrl', event.target.value)} data-testid="input-legal-cookie" />
              </Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard id="pages" eyebrow="Your words" title="Edit your customer pages" description="Change the wording without changing how the website works." icon={<FileText className="h-5 w-5" />}>
          <WebsiteContentEditor value={form.presentation || {}} onChange={value => updateGroup('presentation', value)} />
        </SectionCard>
        <SectionCard id="review" eyebrow="Ready when you are" title="Review your website" description="Check the content, preview your branding, then publish the complete draft." icon={<Check className="h-5 w-5" />}>
          <LaunchReadiness settings={form} /><SettingsPreview settings={form} />
          <p className="text-sm leading-6 text-muted-foreground">Stock credentials, email keys, payment connections and your domain are private deployment settings. They are never stored in the public website settings. Stock photographs and prices come from your dealership’s stock feed.</p>
        </SectionCard>
        {guided && <div className="flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="outline" disabled={stepIndex === 0} onClick={() => scrollToSection(setupSteps[stepIndex - 1][0])}>Previous</Button>{stepIndex < setupSteps.length - 1 && <Button type="button" onClick={() => scrollToSection(setupSteps[stepIndex + 1][0])}>Continue to {setupSteps[stepIndex + 1][1]}</Button>}</div>}

        <div className="sticky bottom-0 z-20 flex flex-col gap-2 border border-border bg-card p-3 sm:p-4 shadow-none sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px]">
            {saveMessage && (
              <p className="flex items-center gap-2 font-bold text-[#1b6543]" data-testid="status-settings-success">
                <Check className="h-4 w-4" />
                {saveMessage}
              </p>
            )}
            {updateSettings.isError && (
              <p className="flex items-center gap-2 font-bold text-destructive" data-testid="status-settings-error">
                <CircleAlert className="h-4 w-4" />
                {apiErrorMessage(updateSettings.error)}
              </p>
            )}
            {Object.keys(validationErrors).length > 0 && !saveMessage && !updateSettings.isError && (
                <p className="flex items-center gap-2 font-bold text-destructive" data-testid="status-settings-validation">
                  <CircleAlert className="h-4 w-4" />{Object.values(validationErrors)[0]}</p>
              )}
            {!saveMessage && !updateSettings.isError && Object.keys(validationErrors).length === 0 && (
                <p className="text-primary/70">{dirty ? 'Unpublished changes — publish when ready.' : 'Showing published settings.'}</p>
              )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Link href="/" className="inline-flex min-h-11 items-center justify-center gap-2 border border-border bg-card px-2 sm:px-6 font-display text-[12px] font-semibold tracking-normal text-primary shadow-none transition-all hover:bg-primary hover:text-primary-foreground" data-testid="link-preview-showroom">
              <ExternalLink className="h-3.5 w-3.5" /> View published showroom</Link>
            <Button type="submit" disabled={updateSettings.isPending} className="min-h-11 px-2 sm:px-4 rounded-md font-display text-[12px] font-semibold tracking-normal shadow-none transition-all" data-testid="button-save-settings">
              <Save className="mr-2 h-4 w-4" />
              {updateSettings.isPending ? 'Publishing…' : guided && activeSection !== 'review' ? 'Review changes' : 'Publish showroom'}
            </Button>
          </div>
        </div>
      </form>
      </ActiveSettingsSection.Provider>
      </div>
    </section>
  );
}
