import { websiteText } from "@/lib/website-content";
import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Check, Copy, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EnquiryForm } from '@/components/enquiry-form';
import { DealershipPhotograph } from '@/components/dealership-photograph';
import { dealershipPhotography } from '@/lib/dealership-photography';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useStock } from '@/lib/stock-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPhoneDisplay } from '@/lib/utils';
import { dealershipLocation } from '@/lib/dealership-location';

export default function Contact() {
  const { settings, isLoading, isError } = useDealerSettings();
  const { stock } = useStock();
  const [copyStatus, setCopyStatus] = useState('');
  const location = dealershipLocation(settings.address);
  const phoneHref = getPhoneHref(settings);
  const whatsAppHref = getWhatsAppHref(`Hello ${settings.identity.name}, I’d like to ask about a car or arrange a visit.`, settings);
  const content = settings.presentation;
  const photos = dealershipPhotography(settings);
  const email = settings.contact.email?.trim();
  usePageMeta({
    title: `Contact us & directions | ${settings.identity.name}`,
    description: `Contact ${settings.identity.name}${settings.address?.city ? ` in ${settings.address.city}` : ''}. Find our contact details, opening hours and information for your visit.`,
  });
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(location.lines.join(', '));
      setCopyStatus('Address copied');
    } catch {
      setCopyStatus('Could not copy automatically. Select and copy the address shown above.');
    }
  };

  return <div className="friendly-page friendly-contact luxxy-shell bg-background pb-14 sm:pb-20">
    <div className="container mx-auto px-4 pt-5 sm:px-6 sm:pt-8 lg:px-8">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to showroom</Link>
      <header className="friendly-banner mt-4 max-w-3xl pb-7 sm:pb-10">
        <p className="luxxy-kicker">{settings.identity.name}{settings.address?.city ? ` · ${settings.address.city}` : ''}</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{websiteText(settings, "contactTitle")}</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">{websiteText(settings, "contactIntroduction")}</p>
        <a href="#find-us-heading" onClick={event => { event.preventDefault(); const heading = document.getElementById('find-us-heading'); heading?.scrollIntoView({ block: 'start' }); heading?.focus({ preventScroll: true }); }} className="text-link mt-3 inline-flex min-h-11 items-center gap-2 lg:hidden">{websiteText(settings, "contactDirectionsHeading")}<MapPin className="h-4 w-4" aria-hidden="true" /></a>
      </header>

      {isLoading ? <div role="status" aria-busy="true" className="mb-8 border-y border-border py-8 text-sm text-muted-foreground">Loading contact and visiting details…</div> : isError ? <div role="alert" className="mb-8 flex flex-wrap items-center justify-between gap-4 border-y border-border py-5"><p className="max-w-xl text-sm leading-6">We couldn’t load the latest dealership details. Please confirm the address and opening hours before travelling.</p><Button variant="outline" onClick={() => window.location.reload()}>Try again</Button></div> : null}

      <div className="grid items-start gap-8 border-t border-border pt-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-10">
        <section aria-labelledby="talk-heading" className="min-w-0">
          <h2 id="talk-heading" className="font-display text-2xl font-semibold tracking-tight">{websiteText(settings, "contactTalkHeading")}</h2>
          <div className="mt-5 divide-y divide-border border-y border-border">
            {phoneHref && <a href={phoneHref} className="group flex min-h-24 items-center gap-4 py-5" data-testid="contact-phone"><Phone className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">Call the team</span><span className="mt-1 block font-display text-xl font-semibold group-hover:text-accent">{formatPhoneDisplay(settings.contact.phone!)}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></a>}
            {whatsAppHref && <a href={whatsAppHref} target="_blank" rel="noopener noreferrer" className="group flex min-h-24 items-center gap-4 py-5" data-testid="contact-whatsapp"><MessageCircle className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">Prefer a message?</span><span className="mt-1 block font-display text-lg font-semibold group-hover:text-accent">Chat on WhatsApp</span><span className="mt-1 block text-xs text-muted-foreground">Opens WhatsApp with a message ready to edit.</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></a>}
            {email && <a href={`mailto:${email}`} className="group flex min-h-24 items-center gap-4 py-5" data-testid="contact-email"><Mail className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">Email us</span><span className="mt-1 block break-all font-semibold group-hover:text-accent">{email}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></a>}
          </div>
          <a href="#contact-message" onClick={event => { event.preventDefault(); document.getElementById('contact-message')?.scrollIntoView({ block: 'start' }); document.getElementById('contact-message-heading')?.focus({ preventScroll: true }); }} className="text-link mt-4 inline-flex min-h-11 items-center gap-2">Send an enquiry online<ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
          <div className="mt-7 border-t border-border pt-6">
            <h3 className="font-display text-xl font-semibold">{websiteText(settings, "contactVisitHeading")}</h3>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{websiteText(settings, "contactVisitDescription")}</p>
            <Button asChild className="mt-5"><Link href="/enquire?type=viewing">Book a test drive<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
          </div>
        </section>

        <section aria-labelledby="find-us-heading" className="min-w-0" data-testid="contact-location">
          {photos.contact && !isLoading && !isError && <DealershipPhotograph photo={photos.contact} className="mb-5" />}
          <div className="bg-primary px-5 py-6 text-primary-foreground sm:p-7">
            <p className="flex items-center gap-2 text-xs text-primary-foreground/75"><MapPin className="h-4 w-4" aria-hidden="true" />Plan your visit</p>
            <h2 id="find-us-heading" tabIndex={-1} className="mt-3 scroll-mt-28 font-display text-2xl font-semibold outline-none">{websiteText(settings, "contactDirectionsHeading")}</h2>
            {!isLoading && !isError && <>
              <p className="mt-5 text-sm font-semibold">{settings.identity.name}</p>
              <address className="mt-2 not-italic text-base leading-7 text-primary-foreground/85" data-testid="contact-address">{location.lines.length ? location.lines.map((line, index) => <div key={index}>{line}</div>) : 'Contact us for the showroom address.'}</address>
              {location.isSample && <p className="mt-4 border-t border-primary-foreground/20 pt-4 text-xs leading-5 text-primary-foreground/80">Sample address for this template. Please contact the team for the correct location before travelling.</p>}
              {location.directions ? <div className="mt-5 flex flex-wrap items-center gap-3"><Button asChild variant="secondary"><a href={location.directions} target="_blank" rel="noopener noreferrer" data-testid="contact-directions">Get directions<ArrowRight className="h-4 w-4" aria-hidden="true" /></a></Button><button type="button" onClick={copyAddress} className="inline-flex min-h-11 items-center gap-2 px-2 text-sm underline underline-offset-4">{copyStatus === 'Address copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}Copy address</button></div> : !location.isSample && <p className="mt-4 text-xs leading-5 text-primary-foreground/80">Please contact the team for directions before setting off.</p>}
              {copyStatus && <p role="status" className="mt-3 text-xs leading-5">{copyStatus}</p>}
            </>}
            {(isLoading || isError) && <p className="mt-5 text-sm leading-6 text-primary-foreground/80">{isLoading ? 'Loading showroom location…' : 'Contact the team to confirm the showroom location.'}</p>}
          </div>
          {!isLoading && !isError && <>
            <div className="mt-6"><h3 className="text-base font-semibold">Opening hours</h3>{settings.hours?.length ? <dl className="mt-3 divide-y divide-border">{settings.hours.map((hour, index) => <div key={index} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm"><dt className="text-muted-foreground">{hour.days}</dt><dd className="font-medium">{hour.times}</dd></div>)}</dl> : <p className="mt-3 text-sm leading-6 text-muted-foreground">Contact us to confirm a suitable time.</p>}<p className="mt-3 text-xs leading-5 text-muted-foreground">Please confirm your test drive before travelling, including visits on bank holidays.</p></div>
          </>}
        </section>
      </div>

      {!isLoading && !isError && <section className="mt-10 grid gap-7 border-y border-border py-7 sm:grid-cols-2 lg:gap-16" aria-label="Before your visit">
        <div><h2 className="font-display text-xl font-semibold">{websiteText(settings, "contactBeforeHeading")}</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{content?.visitInstructions || 'Contact us to confirm the car is available and book a test drive time. We’ll help with any questions before you travel.'}</p></div>
        <div><h2 className="font-display text-xl font-semibold">{websiteText(settings, "contactParkingHeading")}</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{content?.parkingInstructions || 'Ask the team about parking, the entrance and any access requirements when arranging your visit.'}</p></div>
      </section>}

      <section id="contact-message" aria-labelledby="contact-message-heading" className="mt-10 grid scroll-mt-28 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16">
        <div><p className="luxxy-kicker">Send a message</p><h2 id="contact-message-heading" tabIndex={-1} className="mt-3 font-display text-2xl font-semibold tracking-tight outline-none">{websiteText(settings, "contactMessageHeading")}</h2><p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">{websiteText(settings, "contactMessageDescription")}</p><p className="mt-4 text-xs leading-6 text-muted-foreground">Your message goes to the dealership enquiry inbox. We’ll show a reference when it has been received.</p>{photos.reception && !isLoading && !isError && <DealershipPhotograph photo={photos.reception} className="mt-6" />}</div>
        <div className="min-w-0"><EnquiryForm initialType="general" stockCars={stock?.cars ?? []} /></div>
      </section>
    </div>
  </div>;
}
