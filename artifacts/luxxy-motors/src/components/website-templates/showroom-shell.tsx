import { selectedWebsiteTemplate } from '@/lib/website-template';
import { forwardRef, useEffect, useState, type MouseEvent } from 'react';
import { Link, useLocation } from 'wouter';
import type { MultiHomeSettings } from '@/components/multi-home-header';
import { DealerWordmark } from '@/components/brand/wordmark';
import { PrivacyNoticeLink } from '@/components/privacy-notice-link';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Heart, Menu, Phone, MapPin, ArrowUpRight, Mail } from '@/components/icons';
import { formatPhoneDisplay } from '@/lib/utils';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { getFittedShoreDriveLogo } from '@/lib/shore-drive-wordmark';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { multiChoiceHomeSections } from '@/lib/multi-choice-home-sections';
import { homeSectionHref } from '@/lib/private-website-preview';
import { dealershipLocation } from '@/lib/dealership-location';
import { customerOpeningHours } from '@/lib/dealership-customer-copy';

type HeaderProps = {
  settings: MultiHomeSettings; savedCount: number; testDriveHref: string;
  isHomepage?: boolean; enquiriesEnabled?: boolean; onLogoClick?: () => void;
};

export const ShowroomHeader = forwardRef<HTMLElement, HeaderProps>(function ShowroomHeader({ settings, savedCount, testDriveHref, isHomepage = false, enquiriesEnabled = true, onLogoClick }, ref) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const sections = multiChoiceHomeSections(settings);
  const hasAbout = Boolean(settings.whyBuy?.length || settings.trustItems?.length || sections.warranty || settings.testDriveBooking?.enabled);
  const phoneHref = getPhoneHref(settings);
  const phone = formatPhoneDisplay(settings.contact.phone ?? '');
  const logo = isMultiChoiceWebsite() ? '/brand/multi-choice-motors/multi-choice-wordmark.svg' : getFittedShoreDriveLogo(settings.identity.logoAsset, 'header');
  const booking = Boolean(settings.testDriveBooking?.enabled && enquiriesEnabled);
  const pxHref = enquiriesEnabled ? '/enquire?type=part_exchange' : '/contact';
  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1100px)');
    if (!media) return;
    const closeWide = () => { if (media.matches) setOpen(false); };
    media.addEventListener?.('change', closeWide);
    return () => media.removeEventListener?.('change', closeWide);
  }, []);
  function logoClick(event: MouseEvent<HTMLAnchorElement>) {
    setOpen(false);
    if (isHomepage && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
    if (!isHomepage && onLogoClick && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onLogoClick(); }
  }
  const nav = <>
    <Link href="/stock" aria-current={location === '/stock' ? 'page' : undefined}>Used cars</Link>
    {sections.partExchange && <Link href={pxHref}>Part exchange</Link>}
    {hasAbout && <a href={homeSectionHref('about', isHomepage)}>About us</a>}
    <Link href="/contact" aria-current={location === '/contact' ? 'page' : undefined}>Contact</Link>
  </>;
  return <header ref={ref} data-site-header className="sr-header">
    <div className="sr-header-inner">
      <Link href={isHomepage ? '#top' : '/'} className="sr-header-brand" aria-label={`${settings.identity.name} home`} onClick={logoClick}>
        <DealerWordmark {...settings.identity} logoAsset={logo || settings.identity.logoAsset} />
      </Link>
      <nav aria-label="Primary navigation" className="sr-header-nav">{nav}</nav>
      <div className="sr-header-actions">
        <Link href="/saved" className="sr-icon-button sr-header-saved" aria-label={savedCount ? `Saved cars (${savedCount})` : 'Saved cars'}><Heart aria-hidden="true" size={21} />{savedCount > 0 && <span>{savedCount}</span>}</Link>
        {phoneHref && <a href={phoneHref} className="sr-header-phone" aria-label={`Call ${settings.identity.name} on ${phone}`}><Phone aria-hidden="true" size={21} /><span>{phone}</span></a>}
        {booking && <Link href={testDriveHref} className="sr-button sr-header-book">Book a visit</Link>}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><button type="button" className="sr-icon-button sr-header-menu" aria-label="Open navigation menu"><Menu size={25} aria-hidden="true" /></button></SheetTrigger>
          <SheetContent side="right" className={`sr-menu-panel${selectedWebsiteTemplate(settings.presentation) === 'grand-touring' ? ' gt-menu-panel' : ''}`}>
            <SheetHeader><SheetTitle>{settings.identity.name}</SheetTitle><SheetDescription>Find a car or arrange your visit.</SheetDescription></SheetHeader>
            <nav aria-label="Mobile navigation" onClick={() => setOpen(false)}>{nav}{sections.warranty && <Link href="/warranty">Warranty</Link>}{sections.delivery && <a href={homeSectionHref('delivery', isHomepage)}>Delivery</a>}<Link href="/saved">Saved cars{savedCount ? ` (${savedCount})` : ''}</Link>{booking && <Link href={testDriveHref}>Book a visit</Link>}</nav>
            {phoneHref && <a href={phoneHref} className="sr-menu-phone"><Phone size={21} aria-hidden="true" />{phone}</a>}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  </header>;
});

export function ShowroomFooter({ settings, enquiriesEnabled = true }: { settings: MultiHomeSettings; enquiriesEnabled?: boolean }) {
  const sections = multiChoiceHomeSections(settings);
  const address = dealershipLocation(settings.address);
  const phoneHref = getPhoneHref(settings);
  const whatsapp = getWhatsAppHref(undefined, settings);
  const hours = customerOpeningHours(settings.hours);
  const footerLogo = settings.presentation?.footerLogoUrl;
  return <footer className="sr-footer" aria-label={`${settings.identity.name} information`}>
    <div className="sr-container sr-footer-main">
      <div className="sr-footer-brand"><Link href="/" aria-label={`${settings.identity.name} home`}><DealerWordmark {...settings.identity} logoAsset={footerLogo || settings.identity.logoAsset} /></Link><p>Find your next car. Arrange a visit.<br/>We’re here when you need us.</p>{phoneHref && <a href={phoneHref} className="sr-footer-phone">{formatPhoneDisplay(settings.contact.phone ?? '')}</a>}</div>
      <nav aria-label="Dealership links"><h2>Find your way</h2><Link href="/stock">Used cars</Link>{sections.partExchange && <Link href={enquiriesEnabled ? '/enquire?type=part_exchange' : '/contact'}>Part exchange</Link>}{sections.warranty && <Link href="/warranty">Warranty</Link>}{sections.delivery && <a href={homeSectionHref('delivery')}>Delivery</a>}<Link href="/saved">Saved cars</Link><Link href="/contact">Contact us</Link>{enquiriesEnabled && <Link href="/enquire?type=general">Send an enquiry</Link>}</nav>
      <div className="sr-footer-visit"><h2>Visit the showroom</h2>{!address.isSample && address.lines.length > 0 && <p><MapPin size={17} aria-hidden="true" /><span>{address.lines.join(', ')}</span></p>}{hours.length > 0 && <dl>{hours.map((hours, i) => <div key={i}><dt>{hours.days}</dt><dd>{hours.times}</dd></div>)}</dl>}{sections.visit && <a href={homeSectionHref('find-us')} className="sr-footer-directions">Plan your visit<ArrowUpRight size={16} aria-hidden="true" /></a>}{settings.contact.email && <a href={`mailto:${settings.contact.email}`} className="sr-footer-email"><Mail size={16} aria-hidden="true" />Email the team</a>}{whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>}</div>
    </div>
    <div className="sr-container sr-footer-bottom"><p>© {new Date().getFullYear()} {settings.identity.name}</p><div><PrivacyNoticeLink url={settings.legal.privacyUrl} />{settings.legal.termsUrl && <a href={settings.legal.termsUrl}>Terms & conditions</a>}{settings.legal.cookieUrl && <a href={settings.legal.cookieUrl}>Cookies</a>}</div></div>
  </footer>;
}
