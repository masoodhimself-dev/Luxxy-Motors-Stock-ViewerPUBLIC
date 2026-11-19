import { forwardRef, useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'wouter';
import type { DealerConfig } from '@/config/dealer';
import { DealerWordmark } from '@/components/brand/wordmark';
import { GraphiteIcon } from './graphite-icon';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PrivacyNoticeLink } from '@/components/privacy-notice-link';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPhoneDisplay } from '@/lib/utils';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { getFittedShoreDriveLogo } from '@/lib/shore-drive-wordmark';
import { customerOpeningHours, appointmentVisitNote } from '@/lib/dealership-customer-copy';
import { dealershipLocation } from '@/lib/dealership-location';
import { multiChoiceHomeSections } from '@/lib/multi-choice-home-sections';

type Settings = DealerConfig & { testDriveBooking?: { enabled: boolean } };
type HeaderProps = { settings: Settings; savedCount: number; testDriveHref: string; isHomepage?: boolean; enquiriesEnabled?: boolean; onLogoClick?: () => void };

/** Match the reasons/trust section rendered by GraphiteHomepage. */
function hasAboutContent(settings: Settings) {
  const sections = multiChoiceHomeSections(settings);
  const reasons = (settings.whyBuy ?? []).some(reason => reason.title.trim() && reason.description.trim() && (sections.warranty || !/warranty/i.test(reason.title)));
  return Boolean(reasons || (settings.trustItems ?? []).some(item => item.trim()) || sections.warranty || settings.testDriveBooking?.enabled || isMultiChoiceWebsite());
}

export const GraphiteHeader = forwardRef<HTMLElement, HeaderProps>(function GraphiteHeader({ settings, savedCount, testDriveHref, isHomepage = false, enquiriesEnabled = true, onLogoClick }, ref) {
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const phone = getPhoneHref(settings);
  const canBook = Boolean(settings.testDriveBooking?.enabled);
  const canExchange = Boolean(settings.partExchange?.enabled);
  const sections = multiChoiceHomeSections(settings);
  const showAbout = hasAboutContent(settings);
  const whatsApp = getWhatsAppHref(undefined, settings);
  const about = `${isHomepage ? '' : '/'}#about`;
  const delivery = `${isHomepage ? '' : '/'}#delivery`;
  const logo = isMultiChoiceWebsite() ? '/brand/graphite/brand-wordmark.svg' : getFittedShoreDriveLogo(settings.identity.logoAsset, 'header') || settings.identity.logoAsset;
  const exchangeHref = enquiriesEnabled ? '/enquire?type=part_exchange' : '/contact';
  const close = () => { setOpen(false); setServicesOpen(false); };
  useEffect(() => {
    const resize = () => { if (window.innerWidth >= 1100) setOpen(false); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const services = <>
    {canBook && <Link href={testDriveHref} onClick={close}>{settings.bookViewing.ctaLabel}</Link>}
    {sections.warranty && <Link href="/warranty" onClick={close}>Warranty</Link>}
    {sections.delivery && <a href={delivery} onClick={close}>Delivery</a>}
  </>;
  return <header ref={ref} data-site-header className="gr-header">
    <div className="gr-container gr-header__inner">
      <Link href="/" className="gr-header__brand" aria-label={`${settings.identity.name} home`} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        close();
        if (!isHomepage && onLogoClick && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onLogoClick(); }
      }}><DealerWordmark {...settings.identity} logoAsset={logo} /></Link>
      <nav aria-label="Primary navigation" className="gr-header__nav">
        <Link href="/stock">Used cars</Link>
        {canExchange && <Link href={exchangeHref}>Part exchange</Link>}
        {showAbout && <a href={about}>About us</a>}
        {(canBook || sections.warranty || sections.delivery) && <Popover open={servicesOpen} onOpenChange={setServicesOpen}>
          <PopoverTrigger asChild><button type="button">Services<GraphiteIcon name="chevron-down" /></button></PopoverTrigger>
          <PopoverContent align="start" className="gr-services"><nav aria-label="Services">{services}</nav></PopoverContent>
        </Popover>}
        <Link href="/contact">Contact</Link>
      </nav>
      <div className="gr-header__actions">
        <Link href="/saved" className="gr-header__saved" aria-label={`Saved cars${savedCount ? `, ${savedCount} saved` : ''}`}><GraphiteIcon name="heart" />{savedCount > 0 && <span>{savedCount}</span>}</Link>
        {phone && <a href={phone} className="gr-header__phone" aria-label={`Call ${settings.identity.name} on ${formatPhoneDisplay(settings.contact.phone!)}`}><GraphiteIcon name="phone" /><span>{formatPhoneDisplay(settings.contact.phone!)}</span></a>}
        <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><button type="button" className="gr-header__menu" aria-label="Open navigation menu"><GraphiteIcon name="menu" /></button></SheetTrigger>
          <SheetContent side="right" className="gr-menu"><SheetHeader><SheetTitle>{settings.identity.name}</SheetTitle><SheetDescription className="sr-only">Website navigation</SheetDescription></SheetHeader>
            <nav aria-label="Mobile navigation">
              <Link href="/" onClick={close}>Home<GraphiteIcon name="arrow-right" /></Link>
              <Link href="/stock" onClick={close}>Used cars<GraphiteIcon name="arrow-right" /></Link>
              {canExchange && <Link href={exchangeHref} onClick={close}>Part exchange<GraphiteIcon name="arrow-right" /></Link>}
              <Link href="/saved" onClick={close}>Saved cars{savedCount ? ` (${savedCount})` : ''}<GraphiteIcon name="heart" /></Link>
              {showAbout && <a href={about} onClick={close}>About us<GraphiteIcon name="arrow-right" /></a>}
              <Link href="/contact" onClick={close}>Contact<GraphiteIcon name="arrow-right" /></Link>
            </nav>
            {(canBook || sections.warranty || sections.delivery) && <nav className="gr-menu__services" aria-label="Other services">{services}</nav>}
            {phone && <a className="gr-menu__phone" href={phone}>{formatPhoneDisplay(settings.contact.phone!)}</a>}
            {whatsApp && <a className="gr-menu__whatsapp" href={whatsApp} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
            {isMultiChoiceWebsite() && <p>{appointmentVisitNote}</p>}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  </header>;
});

export function GraphiteFooter({ settings, enquiriesEnabled, testDriveHref }: { settings: Settings; enquiriesEnabled: boolean; testDriveHref: string }) {
  const address = dealershipLocation(settings.address);
  const hours = customerOpeningHours(settings.hours);
  const phone = getPhoneHref(settings);
  const sections = multiChoiceHomeSections(settings);
  const showAbout = hasAboutContent(settings);
  return <footer id="contact" data-home-section className="gr-footer" aria-label={`${settings.identity.name} information`}>
    <div className="gr-container">
      <div className="gr-footer__columns">
        <section className="gr-footer__identity"><h2>{settings.identity.name}</h2>
          {!address.isSample && address.lines.length > 0 && <address>{address.lines.map((line, i) => <span key={i}>{line}</span>)}</address>}
          {phone && <a href={phone} className="gr-footer__phone">{formatPhoneDisplay(settings.contact.phone!)}</a>}
          {settings.contact.email && <a className="gr-footer__email" href={`mailto:${settings.contact.email}`}>{settings.contact.email}</a>}
          {isMultiChoiceWebsite() && <p>{appointmentVisitNote}</p>}
          {address.directions && <a href={address.directions} target="_blank" rel="noopener noreferrer">Get directions</a>}
        </section>
        <nav className="gr-footer__links" aria-label="Cars and services"><Link href="/stock">Used cars</Link><Link href="/saved">Saved cars</Link>
          {settings.partExchange?.enabled && <Link href={enquiriesEnabled ? '/enquire?type=part_exchange' : '/contact'}>Part exchange</Link>}
          {settings.testDriveBooking?.enabled && <Link href={testDriveHref}>{settings.bookViewing.ctaLabel}</Link>}
          {sections.warranty && <Link href="/warranty">Warranty</Link>}
          {sections.delivery && <Link href={enquiriesEnabled ? '/enquire?type=general' : '/contact'}>Delivery options</Link>}
          {showAbout && <a href="/#about">About us</a>}<Link href="/contact">Contact</Link><PrivacyNoticeLink url={settings.legal.privacyUrl} />
        </nav>
        {hours.length > 0 && <section className="gr-footer__hours"><h3>Opening hours</h3><dl>{hours.map((h, i) => <div key={i}><dt>{h.days}</dt><dd>{h.times}</dd></div>)}</dl></section>}
      </div>
      <div className="gr-footer__bottom"><div><p>© {new Date().getFullYear()} {settings.legal.companyName?.trim() || settings.identity.name}</p>{(settings.legal.companyNumber || settings.legal.vatNumber) && <p>{settings.legal.companyNumber && <span>Company no. {settings.legal.companyNumber}</span>}{settings.legal.vatNumber && <span>VAT no. {settings.legal.vatNumber}</span>}</p>}</div>
        <nav aria-label="Legal information"><PrivacyNoticeLink url={settings.legal.privacyUrl} />{settings.legal.termsUrl && <a href={settings.legal.termsUrl}>Terms & conditions</a>}{settings.legal.cookieUrl && <a href={settings.legal.cookieUrl}>Cookies</a>}
          {Object.entries(settings.social).filter(([, href]) => href).map(([name, href]) => <a key={name} href={href!} target="_blank" rel="noopener noreferrer">{name === 'twitter' ? 'X / Twitter' : name[0].toUpperCase() + name.slice(1)}</a>)}
        </nav>
      </div>
    </div>
  </footer>;
}
