import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { DealershipPhotograph } from '@/components/dealership-photograph';
import { dealershipPhotography } from '@/lib/dealership-photography';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useStock } from '@/lib/stock-context';
import { getEnquiryHref, getPhoneHref, getVehicleWhatsAppHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPhoneDisplay, formatPrice, vehicleDisplayTitle } from '@/lib/utils';
import { usePageMeta } from '@/hooks/use-page-meta';

const policyQuestions = [
  ['The cover', 'Which parts and faults are covered, and which exclusions apply?'],
  ['The term', 'When does cover start and finish? Is there a mileage limit?'],
  ['The cost', 'Is it included in the vehicle price or an optional extra? Is there an excess to pay?'],
  ['Claim limits', 'What are the limits for each claim, labour rates and the total amount payable?'],
  ['Looking after the car', 'What servicing, maintenance and record-keeping does the policy require?'],
  ['Getting help', 'Who handles a claim, and what approval is needed before repairs begin?'],
] as const;

const commonQuestions = [
  ['Is a warranty included with every car?', 'Please ask about the car you are considering. The team can confirm whether a warranty is included, offered at an additional cost or unavailable for that vehicle.'],
  ['What does the warranty cover?', 'Ask for the policy wording for the warranty offered on your chosen car. Check the covered components, exclusions, claim limits and any contribution you would need to make. This page is a guide to the questions to ask, rather than a list of covered parts.'],
  ['How long does cover last?', 'The duration, start date and any mileage limit need to be confirmed for the specific warranty offered. Ask for these details in writing before you decide.'],
  ['Can I choose a longer warranty?', 'Tell the team what you have in mind. They can confirm whether another term is available for your car and explain any additional cost.'],
  ['What if I need help after buying?', 'Have your registration and warranty documents to hand. Use the contact details and claims process in your policy, or contact the showroom if you need help finding the right information.'],
] as const;

export default function Warranty() {
  const { settings, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const search = useSearch();
  const [vehicleId, setVehicleId] = useState(() => new URLSearchParams(search).get('vehicleId') || '');
  useEffect(() => { setVehicleId(new URLSearchParams(search).get('vehicleId') || ''); }, [search]);
  const vehicle = stock?.cars.find(car => car.id === vehicleId);
  const unavailableVehicle = Boolean(vehicleId && !vehicle && !stockLoading && !stockError);
  const photo = dealershipPhotography(settings).introduction;
  const phoneHref = getPhoneHref(settings);
  const whatsappHref = vehicle
    ? getVehicleWhatsAppHref(vehicle, 'ask about the warranty options', settings)
    : getWhatsAppHref(`Hello ${settings.identity.name}, I’d like to ask about warranty options.`, settings);
  const configuredTitle = settings.warranty?.title?.trim();
  const title = !configuredTitle || configuredTitle === 'Warranty' ? 'Warranty, clearly explained.' : configuredTitle;
  usePageMeta({
    title: `Warranty information | ${settings.identity.name}`,
    description: `Ask ${settings.identity.name} about warranty options for your chosen vehicle, policy terms and how to get help.`,
  });

  const goToEnquiry = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const heading = document.getElementById('warranty-enquiry-heading');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  };

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
            <h1 className="font-display text-3xl font-semibold tracking-tight">Warranty information</h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground" role={settingsError ? 'alert' : undefined}>
              {settingsError ? 'We couldn’t load the latest warranty information. Please try again or contact the showroom.' : 'Please contact the showroom for information about your vehicle and any existing warranty.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {settingsError && <Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>}
              <Button asChild><Link href="/contact">Contact the showroom<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
            </div>
          </section>
        ) : <>
          <header className={`friendly-banner grid items-center gap-7 py-7 sm:py-10 lg:gap-14 ${photo ? 'lg:grid-cols-2' : 'max-w-3xl'}`}>
            <div className="min-w-0">
              <p className="luxxy-kicker">Owning your next car</p>
              <h1 className="mt-3 max-w-lg font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">{title}</h1>
              <p className="mt-5 max-w-lg whitespace-pre-line text-base leading-7 text-muted-foreground">{settings.warranty.description || 'Speak to the team about warranty options for the car you are considering.'}</p>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Know the cover, the cost and the conditions before you decide. Ask us for the details that apply to your chosen car.</p>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Button asChild><a href="#warranty-enquiry" onClick={goToEnquiry}>Ask about warranty<ArrowRight className="h-4 w-4" aria-hidden="true" /></a></Button>
                {phoneHref && <a href={phoneHref} className="text-link inline-flex min-h-11 items-center gap-2"><Phone className="h-4 w-4" aria-hidden="true" />{formatPhoneDisplay(settings.contact.phone!)}</a>}
              </div>
            </div>
            {photo && <DealershipPhotograph photo={photo} />}
          </header>

          <section className="grid gap-7 border-t border-border py-8 sm:py-12 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16" aria-labelledby="warranty-details-heading">
            <div>
              <p className="luxxy-kicker">Before you decide</p>
              <h2 id="warranty-details-heading" className="mt-3 font-display text-2xl font-semibold tracking-tight">The details worth checking.</h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">A useful warranty conversation starts with the policy wording. These are the points to confirm for the car and cover you are considering.</p>
              <p className="mt-5 max-w-md border-l-2 border-accent pl-4 text-sm leading-6">The provider, duration and level of cover need to be confirmed for your vehicle.</p>
            </div>
            <dl className="min-w-0 divide-y divide-border border-y border-border">
              {policyQuestions.map(([label, question]) => <div key={label} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] sm:gap-5">
                <dt className="text-sm font-semibold">{label}</dt>
                <dd className="text-sm leading-6 text-muted-foreground">{question}</dd>
              </div>)}
            </dl>
          </section>

          <section id="warranty-enquiry" className="grid scroll-mt-28 items-start gap-7 border-y border-border bg-card p-5 sm:p-8 lg:grid-cols-2 lg:gap-14" aria-labelledby="warranty-enquiry-heading">
            <div>
              <p className="luxxy-kicker">Start with the car</p>
              <h2 id="warranty-enquiry-heading" tabIndex={-1} className="mt-3 scroll-mt-28 font-display text-2xl font-semibold tracking-tight outline-none">Ask about your chosen vehicle.</h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">Choose a car below and we’ll include it with your enquiry. Still looking, or asking about a car you already own? You can send a general warranty question.</p>
              <Link href="/contact" className="text-link mt-4 inline-flex min-h-11 items-center gap-2">Contact & directions<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
            <div className="min-w-0">
              <label htmlFor="warranty-vehicle" className="field-label">Which car are you asking about? <span className="font-normal text-muted-foreground">(optional)</span></label>
              <NativeSelect id="warranty-vehicle" className="mt-2" value={vehicle ? vehicleId : ''} onChange={event => setVehicleId(event.target.value)} disabled={stockLoading || Boolean(stockError)} aria-describedby="warranty-vehicle-help">
                <option value="">A general question / another vehicle</option>
                {(stock?.cars || []).map(car => <option key={car.id} value={car.id}>{[car.year, vehicleDisplayTitle(car), car.price != null ? formatPrice(car.price, car.currency) : null].filter(Boolean).join(' · ')}</option>)}
              </NativeSelect>
              <p id="warranty-vehicle-help" className="mt-3 text-xs leading-6 text-muted-foreground" role={stockLoading ? 'status' : stockError || unavailableVehicle ? 'alert' : undefined}>
                {stockLoading ? 'Loading current stock. You can still send a general enquiry.' : stockError ? 'We couldn’t load the vehicle list. You can still ask a general warranty question.' : unavailableVehicle ? 'That vehicle is no longer in the current list. Choose another car or send a general enquiry and tell us which vehicle you mean.' : !stock?.cars.length ? 'There are no cars listed at the moment. You can still ask about warranty.' : 'Selecting a car helps the team answer your question; it does not confirm warranty eligibility.'}
              </p>
              <Button asChild className="mt-5 w-full"><Link href={getEnquiryHref('warranty', vehicle)} data-testid="warranty-enquiry-link">{vehicle ? 'Enquire about this car' : 'Send a warranty enquiry'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" data-testid="warranty-whatsapp" className="text-link mt-3 inline-flex min-h-11 items-center gap-2"><MessageCircle className="h-4 w-4" aria-hidden="true" />Ask on WhatsApp</a>}
            </div>
          </section>

          <section className="grid gap-7 py-10 sm:py-12 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16" aria-labelledby="warranty-faq-heading">
            <div><p className="luxxy-kicker">A few useful answers</p><h2 id="warranty-faq-heading" className="mt-3 font-display text-2xl font-semibold tracking-tight">Your warranty questions.</h2></div>
            <Accordion type="single" collapsible className="min-w-0 border-t border-border">
              {commonQuestions.map(([question, answer], index) => <AccordionItem key={question} value={`question-${index}`}><AccordionTrigger className="min-h-14 gap-4 py-5 text-sm">{question}</AccordionTrigger><AccordionContent className="max-w-2xl pr-7 text-sm leading-7 text-muted-foreground">{answer}</AccordionContent></AccordionItem>)}
            </Accordion>
          </section>

          <section className="flex flex-col gap-5 border-t border-border pt-7 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="warranty-aftercare-heading">
            <div><h2 id="warranty-aftercare-heading" className="font-display text-xl font-semibold">Already bought a car?</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Keep your registration and warranty documents handy when contacting the team.</p></div>
            <Button asChild variant="outline" className="shrink-0"><Link href="/contact">Speak to the showroom<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
          </section>
        </>}
      </div>
    </div>
  );
}
