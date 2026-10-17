import { websiteText } from "@/lib/website-content";
import './warranty.css';
import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/page-ui';
import { NativeSelect } from '@/components/ui/native-select';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useStock } from '@/lib/stock-context';
import { getEnquiryHref, getPhoneHref, getVehicleWhatsAppHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPhoneDisplay, formatPrice, vehicleDisplayTitle } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { usePageMeta } from '@/hooks/use-page-meta';

const policyQuestions = [
  ['The cover', 'Which parts and faults are covered, and which exclusions apply?'],
  ['The term', 'When does cover start and finish? Is there a mileage limit?'],
  ['The cost', 'Is it included in the vehicle price or an optional extra? Is there an excess to pay?'],
  ['Claim limits', 'What are the limits for each claim, labour rates and the total amount payable?'],
  ['Looking after the car', 'What servicing, maintenance and record-keeping does the policy require?'],
  ['Getting help', 'Who handles a claim, and what approval is needed before repairs begin?'],
] as const;

export default function Warranty() {
  const { settings, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const search = useSearch();
  const [vehicleId, setVehicleId] = useState(() => new URLSearchParams(search).get('vehicleId') || '');
  useEffect(() => { setVehicleId(new URLSearchParams(search).get('vehicleId') || ''); }, [search]);
  const vehicle = stock?.cars.find(car => car.id === vehicleId);
  const unavailableVehicle = Boolean(vehicleId && !vehicle && !stockLoading && !stockError);
  const phoneHref = getPhoneHref(settings);
  const whatsappHref = vehicle
    ? getVehicleWhatsAppHref(vehicle, 'ask about the warranty options', settings)
    : getWhatsAppHref(`Hello ${settings.identity.name}, I’d like to ask about warranty options.`, settings);
  const configuredTitle = settings.warranty?.title?.trim();
  const title = configuredTitle || 'Warranty';
  usePageMeta({
    title: `Warranty information | ${settings.identity.name}`,
    description: `Ask ${settings.identity.name} about warranty options for your chosen vehicle, policy terms and how to get help.`,
  });

  return (
    <div className="friendly-page friendly-warranty luxxy-shell bg-background pb-14 sm:pb-20">
      <div className="container mx-auto px-4 pt-5 sm:px-6 sm:pt-8 lg:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to showroom
        </Link>

        {settingsLoading ? (
          <div role="status" aria-busy="true" className="py-14 text-sm text-muted-foreground">Loading warranty information…</div>
        ) : settingsError || !settings.warranty?.enabled ? (
          <section className="max-w-2xl py-10 sm:py-16">
            <PageHeading title="Warranty information" />
            <p className="mt-4 text-base leading-7 text-muted-foreground" role={settingsError ? 'alert' : undefined}>
              {settingsError ? 'We couldn’t load the latest warranty information. Please try again or contact us.' : 'Please contact us for information about your vehicle and any existing warranty.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {settingsError && <Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>}
              <Button asChild><Link href="/contact">Contact us<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
            </div>
          </section>
        ) : <>
          <header className="warranty-introduction friendly-banner grid items-start gap-7 py-7 sm:py-10 lg:grid-cols-2 lg:gap-14">
            <div className="min-w-0">
              <p className="luxxy-kicker">{websiteText(settings, "warrantyEyebrow")}</p>
              <h1 className="mt-3 max-w-lg font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">{title}</h1>
              {settings.warranty.description?.trim() && <p className="mt-5 max-w-lg whitespace-pre-line text-base leading-7 text-muted-foreground">{settings.warranty.description.trim()}</p>}
            </div>
            <section className="warranty-enquiry-panel min-w-0 rounded-xl border border-border bg-card p-5 sm:p-7" aria-labelledby="warranty-enquiry-heading">
              <h2 id="warranty-enquiry-heading" className="mb-5 font-display text-xl font-semibold tracking-tight">{websiteText(settings, "warrantyEnquiryHeading")}</h2>
              <label htmlFor="warranty-vehicle" className="field-label">Which car are you asking about? <span className="font-normal text-muted-foreground">(optional)</span></label>
              <NativeSelect id="warranty-vehicle" className="mt-2" value={vehicle ? vehicleId : ''} onChange={event => setVehicleId(event.target.value)} disabled={stockLoading || Boolean(stockError)} aria-describedby="warranty-vehicle-help">
                <option value="">A general question / another vehicle</option>
                {(stock?.cars || []).map(car => <option key={car.id} value={car.id}>{[customerRegistrationDetails(car), vehicleDisplayTitle(car), car.price != null ? formatPrice(car.price, car.currency) : null].filter(Boolean).join(' · ')}</option>)}
              </NativeSelect>
              <p id="warranty-vehicle-help" className="mt-3 text-xs leading-6 text-muted-foreground" role={stockLoading ? 'status' : stockError || unavailableVehicle ? 'alert' : undefined}>
                {stockLoading ? 'Loading current stock. You can still send a general enquiry.' : stockError ? 'We couldn’t load the vehicle list. You can still ask a general warranty question.' : unavailableVehicle ? 'That car is no longer listed. Tell us which vehicle you mean in your enquiry.' : 'We’ll confirm the cover, cost and terms for your car.'}
              </p>
              <Button asChild className="mt-5 w-full"><Link href={getEnquiryHref('warranty', vehicle)} data-testid="warranty-enquiry-link">{vehicle ? 'Enquire about this car' : 'Send a warranty enquiry'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                {phoneHref && <a href={phoneHref} className="text-link inline-flex min-h-11 items-center gap-2"><Phone className="h-4 w-4" aria-hidden="true" />{formatPhoneDisplay(settings.contact.phone!)}</a>}
                {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" data-testid="warranty-whatsapp" className="text-link inline-flex min-h-11 items-center gap-2"><MessageCircle className="h-4 w-4" aria-hidden="true" />WhatsApp</a>}
              </div>
            </section>
          </header>

          <details className="warranty-policy-checklist border-y border-border py-3">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-4 text-sm font-semibold">What to check in the policy<span aria-hidden="true">+</span></summary>
            <dl className="grid min-w-0 gap-x-10 sm:grid-cols-2">{policyQuestions.map(([label, question]) => <div key={label} className="border-t border-border py-4"><dt className="text-sm font-semibold">{label}</dt><dd className="mt-1 text-sm leading-6 text-muted-foreground">{question}</dd></div>)}</dl>
          </details>
          <p className="mt-6 text-sm leading-6 text-muted-foreground">Already bought a car? <Link href="/enquire?type=warranty" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">Ask us for help</Link> with your registration and warranty documents to hand.</p>
        </>}
      </div>
    </div>
  );
}
