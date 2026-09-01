import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getGetDealerSettingsQueryKey,
  type DealerSettings,
  type DealerService,
  useGetDealerSettings,
  useUpdateDealerSettings,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
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

type ServiceKey = 'warranty' | 'delivery' | 'partExchange';
type FormSection = 'identity' | 'contact' | 'homepage' | 'services' | 'proof' | 'legal';

const fallbackSettings: DealerSettings = {
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
    warranty: { ...source.warranty },
    delivery: { ...source.delivery },
    partExchange: { ...source.partExchange },
    bookViewing: { ...source.bookViewing },
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
      <span className="flex items-baseline justify-between gap-3 text-sm font-bold">
        <span>{label}</span>
        {hint && <span className="text-[11px] font-medium text-muted-foreground">{hint}</span>}
      </span>
      {children}
      {error && <span className="block text-xs font-semibold text-destructive">{error}</span>}
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
  return (
    <section id={`settings-${id}`} className="scroll-mt-28 rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
      <div className="mb-6 flex items-start gap-4 border-b pb-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</div>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
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
    <div className={`rounded-2xl border p-5 transition-colors ${service.enabled ? 'border-primary/30 bg-primary/[0.03]' : 'bg-muted/20'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-background text-primary shadow-sm">{icon}</div>
          <div>
            <p className="font-black">{label}</p>
            <p className="text-xs text-muted-foreground">{service.enabled ? 'Visible on your showroom' : 'Hidden from your showroom'}</p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={service.enabled}
            onChange={(event) => onChange({ ...service, enabled: event.target.checked })}
            className="peer sr-only"
            data-testid={`checkbox-service-${label.toLowerCase().replace(/\s+/g, '-')}`}
          />
          <span className="flex h-6 w-10 items-center rounded-full bg-muted p-1 transition-colors peer-checked:bg-primary">
            <span className="h-4 w-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
          </span>
          {service.enabled ? 'On' : 'Off'}
        </label>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
  const settingsQuery = useGetDealerSettings({ query: { queryKey: getGetDealerSettingsQueryKey() } });
  const queryClient = useQueryClient();
  const updateSettings = useUpdateDealerSettings();
  const [form, setForm] = useState<DealerSettings>(fallbackSettings);
  const [initialized, setInitialized] = useState(false);
  const [activeSection, setActiveSection] = useState<FormSection>('identity');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    if (settingsQuery.data && !initialized) {
      setForm(copySettings(settingsQuery.data));
      setInitialized(true);
    }
  }, [initialized, settingsQuery.data]);

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

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.identity.name.trim()) errors['identity.name'] = 'Add the dealership name.';
    if (!form.hero.copy.trim()) errors['hero.copy'] = 'Add a homepage headline.';
    if (!form.hero.subcopy.trim()) errors['hero.subcopy'] = 'Add a short supporting line.';
    if (!form.hero.primaryCta.trim()) errors['hero.primaryCta'] = 'Add a primary button label.';
    if (!form.hero.secondaryCta.trim()) errors['hero.secondaryCta'] = 'Add a secondary button label.';
    if (!form.bookViewing.title.trim()) errors['bookViewing.title'] = 'Add a viewing title.';
    if (!form.bookViewing.description.trim()) errors['bookViewing.description'] = 'Add a viewing description.';
    if (!form.bookViewing.ctaLabel.trim()) errors['bookViewing.ctaLabel'] = 'Add a viewing button label.';
    if (form.hours.some((item) => !item.days.trim() || !item.times.trim())) errors.hours = 'Complete or remove each opening-hours row.';
    if (form.trustItems.some((item) => !item.trim())) errors.trustItems = 'Remove empty trust points or fill them in.';
    if (form.whyBuy.some((item) => !item.title.trim() || !item.description.trim())) errors.whyBuy = 'Complete or remove each why-buy point.';
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      const first = Object.keys(errors)[0];
      if (first.startsWith('identity')) setActiveSection('identity');
      else if (first.startsWith('hero') || first.startsWith('bookViewing')) setActiveSection('homepage');
      else if (first === 'hours') setActiveSection('contact');
      else setActiveSection('proof');
      return false;
    }
    return true;
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveMessage('');
    if (!validate()) return;
    updateSettings.mutate(
      { data: copySettings(form) },
      {
        onSuccess: (saved) => {
          setForm(copySettings(saved));
          setSaveMessage('Published to the showroom. Your changes are live.');
          queryClient.setQueryData(getGetDealerSettingsQueryKey(), saved);
          queryClient.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() });
        },
      },
    );
  };

  const scrollToSection = (section: FormSection) => {
    setActiveSection(section);
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const addHour = () => updateGroup('hours', [...form.hours, { days: '', times: '' }]);
  const addTrustItem = () => {
    if (form.trustItems.length < 8) updateGroup('trustItems', [...form.trustItems, '']);
  };
  const addWhyBuy = () => {
    if (form.whyBuy.length < 8) updateGroup('whyBuy', [...form.whyBuy, { title: '', description: '' }]);
  };

  if (settingsQuery.isLoading && !initialized) {
    return (
      <section className="mb-10 rounded-2xl border bg-card p-6 shadow-sm" data-testid="settings-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-44 rounded bg-muted" />
          <div className="h-9 w-72 rounded bg-muted" />
          <div className="h-24 rounded-xl bg-muted" />
          <div className="grid gap-3 sm:grid-cols-2"><div className="h-12 rounded bg-muted" /><div className="h-12 rounded bg-muted" /></div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10" aria-labelledby="settings-heading">
      <div className="mb-5 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary"><Store className="h-4 w-4" /> Showroom settings</p>
          <h2 id="settings-heading" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Set the shop window</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Control what customers see across the public showroom. Save once, and the live site reflects it without touching code.</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
          <div className="relative h-10 w-10">
            <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90"><path d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" /><path d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31" fill="none" stroke="hsl(var(--accent))" strokeWidth="3" strokeDasharray={`${completeness} 100`} /></svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black">{completeness}%</span>
          </div>
          <div><p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Profile ready</p><p className="text-sm font-black">A stronger first impression</p></div>
        </div>
      </div>

      {settingsQuery.isError && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" data-testid="status-settings-load-error">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><p className="font-bold">Using the current showroom defaults</p><p className="mt-1 text-amber-900/80">We could not load saved settings. You can still edit this profile and try publishing it.</p></div>
        </div>
      )}

      <div className="sticky top-[var(--site-header-height)] z-20 mb-5 overflow-x-auto rounded-xl border bg-background/95 p-1.5 shadow-sm backdrop-blur">
        <nav className="flex min-w-max gap-1" aria-label="Settings sections">
          {([
            ['identity', 'Identity'],
            ['contact', 'Contact & hours'],
            ['homepage', 'Homepage copy'],
            ['services', 'Services'],
            ['proof', 'Trust & why buy'],
            ['legal', 'Social & legal'],
          ] as Array<[FormSection, string]>).map(([section, label]) => (
            <button key={section} type="button" onClick={() => scrollToSection(section)} className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${activeSection === section ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid={`button-settings-nav-${section}`}>{label}</button>
          ))}
        </nav>
      </div>

      <form onSubmit={save} className="space-y-5">
        <SectionCard id="identity" eyebrow="01 / Brand" title="Make it unmistakably yours" description="This is the name, mark and colour language customers will recognise across your site." icon={<Palette className="h-5 w-5" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dealership name" error={validationErrors['identity.name']}><Input required value={form.identity.name} onChange={(event) => updateNested('identity', 'name', event.target.value)} data-testid="input-identity-name" /></Field>
            <Field label="Logo text" hint="Shown when no image is set"><Input value={form.identity.logoText} onChange={(event) => updateNested('identity', 'logoText', event.target.value)} data-testid="input-identity-logo-text" /></Field>
            <Field label="Logo image URL" hint="Optional"><div className="relative"><Image className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-10" type="url" value={form.identity.logoAsset} onChange={(event) => updateNested('identity', 'logoAsset', event.target.value)} placeholder="https://…" data-testid="input-identity-logo-asset" /></div></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary HSL"><Input value={form.identity.brandColors.primaryHsl} onChange={(event) => updateNested('identity', 'brandColors', { ...form.identity.brandColors, primaryHsl: event.target.value })} placeholder="218 39% 16%" data-testid="input-brand-primary" /></Field>
              <Field label="Accent HSL"><Input value={form.identity.brandColors.accentHsl} onChange={(event) => updateNested('identity', 'brandColors', { ...form.identity.brandColors, accentHsl: event.target.value })} placeholder="42 82% 49%" data-testid="input-brand-accent" /></Field>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/25 p-4">
            <div className="h-9 w-9 rounded-lg" style={{ backgroundColor: `hsl(${form.identity.brandColors.primaryHsl})` }} />
            <div className="h-9 w-9 rounded-lg" style={{ backgroundColor: `hsl(${form.identity.brandColors.accentHsl})` }} />
            <p className="text-xs text-muted-foreground">Colour preview. Use space-separated HSL values, for example <span className="font-mono">218 39% 16%</span>.</p>
          </div>
        </SectionCard>

        <SectionCard id="contact" eyebrow="02 / Visit" title="Be easy to reach" description="Give shoppers the details they need to call, message or find the forecourt with confidence." icon={<MapPin className="h-5 w-5" />}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Phone"><Input type="tel" value={form.contact.phone} onChange={(event) => updateNested('contact', 'phone', event.target.value)} data-testid="input-contact-phone" /></Field>
            <Field label="WhatsApp"><Input type="tel" value={form.contact.whatsapp} onChange={(event) => updateNested('contact', 'whatsapp', event.target.value)} data-testid="input-contact-whatsapp" /></Field>
            <Field label="Email"><Input type="email" value={form.contact.email} onChange={(event) => updateNested('contact', 'email', event.target.value)} data-testid="input-contact-email" /></Field>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Street address"><Input value={form.address.street} onChange={(event) => updateNested('address', 'street', event.target.value)} data-testid="input-address-street" /></Field>
            <Field label="Town / city"><Input value={form.address.city} onChange={(event) => updateNested('address', 'city', event.target.value)} data-testid="input-address-city" /></Field>
            <Field label="Region"><Input value={form.address.region} onChange={(event) => updateNested('address', 'region', event.target.value)} data-testid="input-address-region" /></Field>
            <Field label="Postcode"><Input value={form.address.postcode} onChange={(event) => updateNested('address', 'postcode', event.target.value)} data-testid="input-address-postcode" /></Field>
            <Field label="Google Maps link" hint="Optional"><div className="relative"><Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-10" type="url" value={form.address.mapsUrl} onChange={(event) => updateNested('address', 'mapsUrl', event.target.value)} placeholder="https://maps.google.com/…" data-testid="input-address-maps" /></div></Field>
          </div>
          <div className="mt-6 rounded-xl border bg-muted/20 p-4">
            <div className="mb-4 flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 font-black"><Clock3 className="h-4 w-4 text-primary" /> Opening hours</p><p className="mt-1 text-xs text-muted-foreground">Add the hours exactly as you want them shown publicly.</p></div><Button type="button" size="sm" variant="outline" onClick={addHour} disabled={form.hours.length >= 14} data-testid="button-add-hours"><Plus className="mr-1.5 h-4 w-4" /> Add row</Button></div>
            <div className="space-y-3">
              {form.hours.map((item, index) => (
                <div key={`hour-${index}`} className="flex flex-col gap-2 sm:flex-row">
                  <Input value={item.days} onChange={(event) => { const hours = [...form.hours]; hours[index] = { ...item, days: event.target.value }; updateGroup('hours', hours); }} placeholder="Monday – Friday" data-testid={`input-hours-days-${index}`} />
                  <Input value={item.times} onChange={(event) => { const hours = [...form.hours]; hours[index] = { ...item, times: event.target.value }; updateGroup('hours', hours); }} placeholder="09:00 – 18:00" data-testid={`input-hours-times-${index}`} />
                  <Button type="button" size="icon" variant="ghost" onClick={() => updateGroup('hours', form.hours.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove hours row ${index + 1}`} data-testid={`button-remove-hours-${index}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              ))}
              {form.hours.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No opening hours added yet.</p>}
            </div>
            {validationErrors.hours && <p className="mt-2 text-xs font-semibold text-destructive">{validationErrors.hours}</p>}
          </div>
        </SectionCard>

        <SectionCard id="homepage" eyebrow="03 / First impression" title="Write the welcome" description="Shape the first few seconds of the showroom: your announcement, headline, supporting line and calls to action." icon={<Store className="h-5 w-5" />}>
          <div className="grid gap-4">
            <Field label="Announcement strip" hint="Optional"><Input value={form.hero.announcement} onChange={(event) => updateNested('hero', 'announcement', event.target.value)} placeholder="New stock added this week" data-testid="input-hero-announcement" /></Field>
            <Field label="Homepage headline" error={validationErrors['hero.copy']}><Input required value={form.hero.copy} onChange={(event) => updateNested('hero', 'copy', event.target.value)} data-testid="input-hero-copy" /></Field>
            <Field label="Supporting copy" error={validationErrors['hero.subcopy']}><Textarea required rows={3} value={form.hero.subcopy} onChange={(event) => updateNested('hero', 'subcopy', event.target.value)} data-testid="textarea-hero-subcopy" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary button" error={validationErrors['hero.primaryCta']}><Input required value={form.hero.primaryCta} onChange={(event) => updateNested('hero', 'primaryCta', event.target.value)} data-testid="input-hero-primary-cta" /></Field>
              <Field label="Secondary button" error={validationErrors['hero.secondaryCta']}><Input required value={form.hero.secondaryCta} onChange={(event) => updateNested('hero', 'secondaryCta', event.target.value)} data-testid="input-hero-secondary-cta" /></Field>
            </div>
          </div>
          <div className="mt-6 border-t pt-6">
            <p className="mb-4 text-sm font-black">Viewing invitation</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" error={validationErrors['bookViewing.title']}><Input required value={form.bookViewing.title} onChange={(event) => updateNested('bookViewing', 'title', event.target.value)} data-testid="input-viewing-title" /></Field>
              <Field label="Button label" error={validationErrors['bookViewing.ctaLabel']}><Input required value={form.bookViewing.ctaLabel} onChange={(event) => updateNested('bookViewing', 'ctaLabel', event.target.value)} data-testid="input-viewing-cta" /></Field>
              <Field label="Description" error={validationErrors['bookViewing.description']}><Textarea required rows={3} value={form.bookViewing.description} onChange={(event) => updateNested('bookViewing', 'description', event.target.value)} data-testid="textarea-viewing-description" /></Field>
            </div>
          </div>
        </SectionCard>

        <SectionCard id="services" eyebrow="04 / Offer" title="Choose what you promise" description="Turn customer-facing services on or off, then make the wording sound like your team." icon={<Truck className="h-5 w-5" />}>
          <div className="grid gap-4">
            <ServiceEditor label="Warranty" service={form.warranty} icon={<Check className="h-5 w-5" />} onChange={(service) => updateGroup('warranty', service)} />
            <ServiceEditor label="Nationwide delivery" service={form.delivery} icon={<Truck className="h-5 w-5" />} onChange={(service) => updateGroup('delivery', service)} />
            <ServiceEditor label="Part exchange" service={form.partExchange} icon={<Store className="h-5 w-5" />} onChange={(service) => updateGroup('partExchange', service)} />
          </div>
        </SectionCard>

        <SectionCard id="proof" eyebrow="05 / Confidence" title="Add the reasons to choose you" description="Short, specific proof points help customers decide to make the call or book the viewing." icon={<Check className="h-5 w-5" />}>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-end justify-between gap-3"><div><p className="font-black">Trust points</p><p className="mt-1 text-xs text-muted-foreground">A compact strip of promises near the stock.</p></div><Button type="button" size="sm" variant="outline" onClick={addTrustItem} disabled={form.trustItems.length >= 8} data-testid="button-add-trust-item"><Plus className="mr-1.5 h-4 w-4" /> Add</Button></div>
              <div className="space-y-2">
                {form.trustItems.map((item, index) => <div key={`trust-${index}`} className="flex gap-2"><Input value={item} onChange={(event) => { const items = [...form.trustItems]; items[index] = event.target.value; updateGroup('trustItems', items); }} placeholder="Carefully selected vehicles" data-testid={`input-trust-item-${index}`} /><Button type="button" size="icon" variant="ghost" onClick={() => updateGroup('trustItems', form.trustItems.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove trust point ${index + 1}`} data-testid={`button-remove-trust-item-${index}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></div>)}
              </div>
              {validationErrors.trustItems && <p className="mt-2 text-xs font-semibold text-destructive">{validationErrors.trustItems}</p>}
            </div>
            <div>
              <div className="mb-3 flex items-end justify-between gap-3"><div><p className="font-black">Why buy from us</p><p className="mt-1 text-xs text-muted-foreground">Up to eight fuller reasons for the about section.</p></div><Button type="button" size="sm" variant="outline" onClick={addWhyBuy} disabled={form.whyBuy.length >= 8} data-testid="button-add-why-buy"><Plus className="mr-1.5 h-4 w-4" /> Add</Button></div>
              <div className="space-y-3">
                {form.whyBuy.map((item, index) => <div key={`why-${index}`} className="rounded-xl border bg-muted/20 p-3"><div className="flex gap-2"><Input value={item.title} onChange={(event) => { const items = [...form.whyBuy]; items[index] = { ...item, title: event.target.value }; updateGroup('whyBuy', items); }} placeholder="Straightforward buying" data-testid={`input-why-buy-title-${index}`} /><Button type="button" size="icon" variant="ghost" onClick={() => updateGroup('whyBuy', form.whyBuy.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove why buy point ${index + 1}`} data-testid={`button-remove-why-buy-${index}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></div><Textarea className="mt-2" rows={2} value={item.description} onChange={(event) => { const items = [...form.whyBuy]; items[index] = { ...item, description: event.target.value }; updateGroup('whyBuy', items); }} placeholder="Clear information and no surprises." data-testid={`textarea-why-buy-description-${index}`} /></div>)}
              </div>
              {validationErrors.whyBuy && <p className="mt-2 text-xs font-semibold text-destructive">{validationErrors.whyBuy}</p>}
            </div>
          </div>
        </SectionCard>

        <SectionCard id="legal" eyebrow="06 / Details" title="Finish the public footprint" description="Keep social profiles and company details in one place so the footer stays current." icon={<ExternalLink className="h-5 w-5" />}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Instagram"><Input type="url" value={form.social.instagram} onChange={(event) => updateNested('social', 'instagram', event.target.value)} placeholder="https://instagram.com/…" data-testid="input-social-instagram" /></Field>
            <Field label="Facebook"><Input type="url" value={form.social.facebook} onChange={(event) => updateNested('social', 'facebook', event.target.value)} placeholder="https://facebook.com/…" data-testid="input-social-facebook" /></Field>
            <Field label="X / Twitter"><Input type="url" value={form.social.twitter} onChange={(event) => updateNested('social', 'twitter', event.target.value)} placeholder="https://x.com/…" data-testid="input-social-twitter" /></Field>
          </div>
          <div className="mt-6 border-t pt-6">
            <p className="mb-4 text-sm font-black">Company and policy links</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Registered company name"><Input value={form.legal.companyName} onChange={(event) => updateNested('legal', 'companyName', event.target.value)} data-testid="input-legal-company-name" /></Field>
              <Field label="Company number"><Input value={form.legal.companyNumber} onChange={(event) => updateNested('legal', 'companyNumber', event.target.value)} data-testid="input-legal-company-number" /></Field>
              <Field label="VAT number"><Input value={form.legal.vatNumber} onChange={(event) => updateNested('legal', 'vatNumber', event.target.value)} data-testid="input-legal-vat-number" /></Field>
              <Field label="Terms link"><Input type="url" value={form.legal.termsUrl} onChange={(event) => updateNested('legal', 'termsUrl', event.target.value)} data-testid="input-legal-terms" /></Field>
              <Field label="Privacy link"><Input type="url" value={form.legal.privacyUrl} onChange={(event) => updateNested('legal', 'privacyUrl', event.target.value)} data-testid="input-legal-privacy" /></Field>
              <Field label="Cookie link"><Input type="url" value={form.legal.cookieUrl} onChange={(event) => updateNested('legal', 'cookieUrl', event.target.value)} data-testid="input-legal-cookie" /></Field>
            </div>
          </div>
        </SectionCard>

        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border bg-card/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-10 text-sm">
            {saveMessage && <p className="flex items-center gap-2 font-bold text-green-700" data-testid="status-settings-success"><Check className="h-4 w-4" />{saveMessage}</p>}
            {updateSettings.isError && <p className="flex items-center gap-2 font-bold text-destructive" data-testid="status-settings-error"><CircleAlert className="h-4 w-4" />{apiErrorMessage(updateSettings.error)}</p>}
            {Object.keys(validationErrors).length > 0 && !saveMessage && !updateSettings.isError && <p className="flex items-center gap-2 font-bold text-destructive" data-testid="status-settings-validation"><CircleAlert className="h-4 w-4" />A few fields need your attention.</p>}
            {!saveMessage && !updateSettings.isError && Object.keys(validationErrors).length === 0 && <p className="text-muted-foreground">Changes stay here until you publish them.</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground" data-testid="link-preview-showroom"><ExternalLink className="h-4 w-4" /> Preview showroom</Link>
            <Button type="submit" disabled={updateSettings.isPending} className="font-bold" data-testid="button-save-settings"><Save className="mr-2 h-4 w-4" />{updateSettings.isPending ? 'Publishing…' : 'Publish showroom'}</Button>
          </div>
        </div>
      </form>
    </section>
  );
}