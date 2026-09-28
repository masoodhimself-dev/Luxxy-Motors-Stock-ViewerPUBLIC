import { DealerWordmark } from "@/components/brand/wordmark";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, X, Phone, MessageCircle, ArrowRight, Instagram, Facebook, Twitter, MapPin, Heart, CalendarDays } from 'lucide-react';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { getEnquiryHref } from '@/lib/cta-helpers';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CompareTray } from '@/components/compare-tray';
import { isWritableFormControl } from '@/lib/form-draft';
import { formatPhoneDisplay } from '@/lib/utils';
import { getUpcomingVisitDates } from '@/lib/upcoming-visit-dates';

const navLinkClass =
  'whitespace-nowrap font-display text-[14px] font-semibold tracking-normal text-primary/75 transition-colors hover:text-accent';
const mobileNavRowClass =
  'flex min-h-12 items-center justify-between border-b border-primary/10 py-2 text-left font-display text-base font-semibold text-primary transition-colors hover:text-accent';
const footerLinkClass =
  'min-h-11 text-left text-[14px] font-medium text-primary-foreground/80 transition-colors hover:text-accent';
const footerHeadingClass = 'font-display text-lg font-semibold text-primary-foreground mb-5';
const socialLinkClass =
  'grid h-11 w-11 place-items-center rounded-lg bg-primary-foreground/10 text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

function hslToRelativeLuminance(hsl: string) {
  const values = hsl.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!values || values.length < 3) return null;
  const [rawHue, rawSaturation, rawLightness] = values;
  const hue = ((rawHue % 360) + 360) % 360 / 360;
  const saturation = Math.min(100, Math.max(0, rawSaturation)) / 100;
  const lightness = Math.min(100, Math.max(0, rawLightness)) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue * 12) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [red, green, blue] = [channel(0), channel(8), channel(4)].map(linear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function readableForegroundForHsl(hsl: string) {
  const backgroundLuminance = hslToRelativeLuminance(hsl);
  if (backgroundLuminance == null) return '0 0% 100%';
  const dark = '0 0% 8%';
  const light = '0 0% 100%';
  const darkLuminance = hslToRelativeLuminance(dark) ?? 0;
  const lightLuminance = hslToRelativeLuminance(light) ?? 1;
  const contrastWithDark = (Math.max(backgroundLuminance, darkLuminance) + 0.05) / (Math.min(backgroundLuminance, darkLuminance) + 0.05);
  const contrastWithLight = (Math.max(backgroundLuminance, lightLuminance) + 0.05) / (Math.min(backgroundLuminance, lightLuminance) + 0.05);
  return contrastWithDark >= contrastWithLight ? dark : light;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const isStaff = location.startsWith('/portal');
  const isCustomerTask = /^\/(sign|customer-details|viewing)\//.test(location);
  const { settings: dealerConfig } = useDealerSettings();
  const { savedCount } = useSavedCars();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const hasEditedFormRef = useRef(false);

  // Adopt the current palette for the original template defaults; preserve bespoke colours.
  const brandPrimary = dealerConfig.identity.brandColors?.primaryHsl === '161.538 16.883% 15.098%' ? '195 22% 13%' : dealerConfig.identity.brandColors?.primaryHsl;
  const brandAccent = dealerConfig.identity.brandColors?.accentHsl === '30.000 40.659% 35.686%' ? '190 86% 44%' : dealerConfig.identity.brandColors?.accentHsl;
  const brandStyle = {
    ...(brandPrimary
      ? {
          '--primary': brandPrimary,
          '--primary-foreground': readableForegroundForHsl(brandPrimary),
        }
      : {}),
    ...(brandAccent
      ? {
          '--accent': brandAccent,
          '--accent-foreground': readableForegroundForHsl(brandAccent),
        }
      : {}),
  } as CSSProperties;

  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(' · ');
  const upcomingVisitDates = getUpcomingVisitDates(dealerConfig.hours ?? []);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    mobileMenuRef.current?.querySelector<HTMLElement>('button, a')?.focus();

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileMenuOpen(false);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    };

    document.addEventListener('keydown', handleMenuKeyDown);
    return () => document.removeEventListener('keydown', handleMenuKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    hasEditedFormRef.current = false;
  }, [location]);

  useEffect(() => {
    const markFormAsEdited = (event: Event) => {
      if (isWritableFormControl(event.target)) {
        hasEditedFormRef.current = true;
      }
    };

    document.addEventListener('input', markFormAsEdited, true);
    document.addEventListener('change', markFormAsEdited, true);
    return () => {
      document.removeEventListener('input', markFormAsEdited, true);
      document.removeEventListener('change', markFormAsEdited, true);
    };
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const updateHeaderHeight = () => {
      document.documentElement.style.setProperty(
        '--site-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    };

    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(header);

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--site-header-height');
    };
  }, []);

  const handleNav = (target: string) => {
    setMobileMenuOpen(false);
    navigateToHomeTarget(target, location, setLocation);
  };

  const handleLogoClick = () => {
    if (
      location !== '/' &&
      hasEditedFormRef.current &&
      document.querySelector('form:not([data-preserves-draft])') &&
      !window.confirm('You have unfinished details on this page. Leave them and return to the homepage?')
    ) {
      return;
    }
    handleNav('top');
  };

  return (
    <div style={brandStyle} className="luxxy-shell min-h-[100dvh] flex flex-col bg-background font-sans text-foreground">
      <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-24 rounded-md bg-primary px-5 py-3 text-primary-foreground focus:translate-y-0">Skip to content</a>
      <header
        ref={headerRef}
        data-site-header
        className={`fixed top-0 left-0 right-0 z-50 w-full border-b transition-all duration-300 ${location === "/" && !scrolled && !mobileMenuOpen ? "stock-home-header" : ""} ${
          scrolled
            ? 'border-primary/15 bg-background shadow-none'
            : 'border-primary/10 bg-background'
        }`}
      >
        <div className="container mx-auto flex h-[4.75rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={handleLogoClick} className="flex min-w-0 items-center gap-3 text-left group">
            <DealerWordmark {...dealerConfig.identity} className="text-primary" />
          </button>

          {isStaff ? <Button variant="outline" className="shrink-0 px-3 text-xs" onClick={() => handleNav('top')}>View showroom <ArrowRight className="h-4 w-4" /></Button> : <>
          {/* Desktop Nav - Condensed */}
          <nav className="hidden items-center gap-6 lg:flex 2xl:hidden" aria-label="Primary navigation">
            <button onClick={() => handleNav('stock')} className={navLinkClass}>Browse Stock</button>
            {dealerConfig.warranty?.enabled && <Link href="/warranty" aria-current={location === '/warranty' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>Warranty</Link>}
            <Link href="/contact" aria-current={location === '/contact' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>Contact us</Link>
            <button
              type="button"
              onClick={() => setLocation('/saved')}
              aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'}
              data-testid="link-saved-cars-condensed"
              className="relative flex items-center gap-2 font-display text-[13px] font-bold tracking-normal text-primary/80 transition-colors hover:text-accent"
            >
              <Heart className={`h-5 w-5 ${savedCount > 0 ? 'text-accent fill-current' : ''}`} />
              {savedCount > 0 && (
                <span className="absolute -top-2 -right-2.5 bg-accent text-accent-foreground text-[10px] font-semibold px-1.5 min-w-[20px] text-center h-5 flex items-center justify-center rounded-md shadow-none">
                  {savedCount}
                </span>
              )}
            </button>
            <Button
              onClick={() => setLocation(getEnquiryHref('viewing'))}
              className="h-11 px-6 font-display text-[13px] font-bold tracking-normal bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground rounded-md shadow-none transition-all ml-4"
            >
              {dealerConfig.bookViewing.ctaLabel}
            </Button>
          </nav>

          {/* Desktop Nav - Full */}
          <nav className="hidden 2xl:flex items-center gap-8" aria-label="Primary navigation">
            <button onClick={() => handleNav('stock')} className={navLinkClass}>Browse Stock</button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className={navLinkClass}>Part Ex</button>}
            {dealerConfig.warranty?.enabled && <Link href="/warranty" aria-current={location === '/warranty' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>Warranty</Link>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className={navLinkClass}>Delivery</button>}
            <Link href="/contact" aria-current={location === '/contact' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>Contact us</Link>

            <div className="flex items-center gap-6 ml-4 pl-8 border-l-2 border-primary/10">
              {dealerConfig.contact.phone && (
                <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="group flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:scale-110" />
                  <span className="whitespace-nowrap font-display text-[14px] font-bold tracking-normal text-primary transition-colors group-hover:text-accent">
                    {formatPhoneDisplay(dealerConfig.contact.phone)}
                  </span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setLocation('/saved')}
                aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'}
                data-testid="link-saved-cars"
                className={`group relative flex items-center gap-2 ${navLinkClass}`}
              >
                <Heart className={`h-5 w-5 transition-transform group-hover:scale-110 ${savedCount > 0 ? 'text-accent fill-current' : 'group-hover:text-accent'}`} />
                <span>Saved</span>
                {savedCount > 0 && (
                  <span className="absolute -top-2 -right-3 bg-accent text-accent-foreground text-[10px] font-semibold px-1.5 min-w-[20px] text-center h-5 flex items-center justify-center rounded-md shadow-none">
                    {savedCount}
                  </span>
                )}
              </button>
               <Button
                 onClick={() => setLocation(getEnquiryHref('viewing'))}
                 className="h-12 px-7 font-display text-[13px] font-bold tracking-normal bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground rounded-md shadow-none transition-all ml-4"
               >
                 {dealerConfig.bookViewing.ctaLabel}
              </Button>
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <button type="button" onClick={() => setLocation('/saved')} aria-label={`Saved cars${savedCount ? `, ${savedCount} saved` : ''}`} className="relative grid h-11 w-11 place-items-center text-primary"><Heart className="h-5 w-5" />{savedCount > 0 && <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-accent text-[10px] text-accent-foreground">{savedCount}</span>}</button>
          {/* Mobile Menu Toggle */}
          <button
            ref={menuButtonRef}
            type="button"
             className="lg:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-secondary/60 text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          </div>
          </>}
        </div>

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <nav id="mobile-navigation" ref={mobileMenuRef} aria-label="Mobile navigation" className="lg:hidden absolute left-0 top-[4.75rem] flex max-h-[calc(100dvh-4.75rem)] w-full flex-col overflow-y-auto border-b border-primary/15 bg-background px-4 pb-8 pt-4 shadow-none">
            <button onClick={() => handleNav('top')} className={mobileNavRowClass}>Home <ArrowRight className="w-5 h-5 opacity-40" /></button>
            <button onClick={() => handleNav('stock')} className={mobileNavRowClass}>
              Browse Stock <ArrowRight className="w-5 h-5 text-accent" />
            </button>
            <button onClick={() => { setMobileMenuOpen(false); setLocation(getEnquiryHref('viewing')); }} className={mobileNavRowClass}>Book a test drive <CalendarDays className="h-5 w-5 text-accent" /></button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className={mobileNavRowClass}>Part Exchange <ArrowRight className="w-5 h-5 opacity-40" /></button>}
            {dealerConfig.warranty?.enabled && <Link href="/warranty" onClick={() => setMobileMenuOpen(false)} aria-current={location === '/warranty' ? 'page' : undefined} className={mobileNavRowClass}>Warranty <ArrowRight className="w-5 h-5 opacity-40" /></Link>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className={mobileNavRowClass}>Delivery <ArrowRight className="w-5 h-5 opacity-40" /></button>}
            <button
              onClick={() => { setMobileMenuOpen(false); setLocation('/saved'); }}
              data-testid="link-saved-cars-mobile"
              className={mobileNavRowClass}
            >
              <span className="flex items-center gap-3">
                Saved Cars
                {savedCount > 0 && (
                  <span className="grid h-6 min-w-[24px] place-items-center bg-accent px-1.5 font-display text-[12px] font-semibold text-accent-foreground rounded-md shadow-none">
                    {savedCount}
                  </span>
                )}
              </span>
              <Heart className={`w-5 h-5 text-accent ${savedCount > 0 ? 'fill-current' : ''}`} />
            </button>
            <button onClick={() => handleNav('about')} className={mobileNavRowClass}>Why Buy From Us <ArrowRight className="w-5 h-5 opacity-40" /></button>
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} aria-current={location === '/contact' ? 'page' : undefined} className={mobileNavRowClass}>Contact us <ArrowRight className="w-5 h-5 opacity-40" /></Link>

            <div className="mt-8 flex flex-col gap-4 pb-4">
              {dealerConfig.contact.phone && (
                <a
                  href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}
                  className="flex items-center justify-between p-4 bg-primary text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="font-display font-bold tracking-normal text-sm flex items-center gap-3"><Phone className="h-5 w-5" /> Call us</span>
                  <span className="font-display font-semibold tracking-normal text-base">{formatPhoneDisplay(dealerConfig.contact.phone)}</span>
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a
                  href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-4 bg-[hsl(var(--contact))] text-white transition-colors hover:opacity-90"
                >
                  <span className="font-display font-bold tracking-normal text-sm flex items-center gap-3"><MessageCircle className="h-5 w-5" /> Message</span>
                  <span className="font-display font-semibold tracking-normal text-base">WhatsApp</span>
                </a>
              )}
            </div>
          </nav>
        )}
      </header>

      <main id="main-content" tabIndex={-1} className={`flex-1 w-full flex flex-col ${location === '/' ? '' : 'pt-[var(--site-header-height)]'}`}>
        {children}
      </main>

      {isCustomerTask && (
        <footer className="mt-auto border-t border-border bg-card px-4 py-6 sm:px-6" data-testid="customer-task-footer">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-8 gap-y-3 text-sm">
            <div><p className="font-semibold">{dealerConfig.identity.name}</p><p className="mt-1 text-muted-foreground">Need help with your documents or visit? Contact the team.</p></div>
            <div className="flex flex-wrap items-center gap-x-5">
              {dealerConfig.contact.phone && <a className="text-link min-h-11" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>{formatPhoneDisplay(dealerConfig.contact.phone)}</a>}
              {dealerConfig.contact.email && <a className="text-link min-h-11 break-all" href={`mailto:${dealerConfig.contact.email}`}>Email the showroom</a>}
              {dealerConfig.legal.privacyUrl && <a className="text-link min-h-11" href={dealerConfig.legal.privacyUrl}>Privacy</a>}
            </div>
          </div>
        </footer>
      )}
      <footer hidden={isStaff || isCustomerTask} id="contact" data-home-section className="mt-auto border-t border-primary/10 bg-primary pt-12 pb-8 text-primary-foreground">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="mb-10 grid grid-cols-2 gap-6 lg:grid-cols-12 lg:gap-12">
            <div className="col-span-2 lg:col-span-5">
               <DealerWordmark {...dealerConfig.identity} className="mb-4 text-primary-foreground" />
              {locationLabel && (
                 <p className="mb-6 font-display text-xs font-medium tracking-normal text-primary-foreground/75">{locationLabel}</p>
              )}
              <p className="mb-4 max-w-sm text-sm leading-relaxed text-primary-foreground/80 font-medium">
                {dealerConfig.hero.subcopy.trim().toLowerCase() === 'quality used vehicles. straightforward buying. exceptional service.'
                  ? 'Clear details, fair prices and time to look properly before you decide.'
                  : dealerConfig.hero.subcopy}
              </p>
            <div className="flex items-center gap-3">
                {dealerConfig.social.instagram && (
                  <a href={dealerConfig.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className={socialLinkClass}>
                    <Instagram className="w-5 h-5" />
                  </a>
                )}
                {dealerConfig.social.facebook && (
                  <a href={dealerConfig.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className={socialLinkClass}>
                    <Facebook className="w-5 h-5" />
                  </a>
                )}
                {dealerConfig.social.twitter && (
                  <a href={dealerConfig.social.twitter} target="_blank" rel="noopener noreferrer" aria-label="Twitter" className={socialLinkClass}>
                    <Twitter className="w-5 h-5" />
                  </a>
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              <h3 className={footerHeadingClass}>Vehicles</h3>
              <nav className="flex flex-col items-start gap-0">
                <button onClick={() => handleNav('stock')} className={footerLinkClass}>Browse Stock</button>
                <button onClick={() => handleNav('part-exchange')} className={footerLinkClass}>Part exchange</button>
                <button onClick={() => setLocation(getEnquiryHref('viewing'))} className={footerLinkClass}>{dealerConfig.bookViewing.ctaLabel}</button>
                {dealerConfig.warranty?.enabled && <Link href="/warranty" aria-current={location === '/warranty' ? 'page' : undefined} className={`inline-flex items-center ${footerLinkClass}`}>Warranty</Link>}
              </nav>
            </div>

            <div className="lg:col-span-2">
              <h3 className={footerHeadingClass}>Visit</h3>
              <Link href="/contact" className={`mb-3 inline-flex items-center gap-2 ${footerLinkClass}`}>Contact & directions <ArrowRight className="h-4 w-4 shrink-0" /></Link>
              <div className="space-y-5 text-sm text-primary-foreground/80 font-medium">
                {dealerConfig.contact.phone && (
                  <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="group flex items-center gap-3 transition-colors hover:text-accent">
                    <Phone className="w-4 h-4 shrink-0 text-accent group-hover:scale-110 transition-transform" />
                    <span className="font-display font-bold tracking-normal text-primary-foreground group-hover:text-accent">{formatPhoneDisplay(dealerConfig.contact.phone)}</span>
                  </a>
                )}
                {dealerConfig.contact.email && (
                  <a href={`mailto:${dealerConfig.contact.email}`} className="group flex items-center gap-3 transition-colors hover:text-accent truncate">
                    <MessageCircle className="w-4 h-4 shrink-0 text-accent group-hover:scale-110 transition-transform" />
                    <span className="truncate">{dealerConfig.contact.email}</span>
                  </a>
                )}
                {dealerConfig.address && (
                  <div className="flex items-start gap-3 mt-4">
                    <MapPin className="w-4 h-4 text-accent shrink-0 mt-1" />
                    <address className="not-italic space-y-1 leading-relaxed">
                      {dealerConfig.address.street && <p>{dealerConfig.address.street}</p>}
                      {dealerConfig.address.city && <p>{dealerConfig.address.city}</p>}
                      {dealerConfig.address.postcode && <p className="text-primary-foreground font-bold">{dealerConfig.address.postcode}</p>}
                      {dealerConfig.address.mapsUrl && (
                        <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 font-display text-[11px] font-bold tracking-normal text-accent hover:text-primary-foreground transition-colors group">
                          Directions <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                        </a>
                      )}
                    </address>
                  </div>
                )}
              </div>
            </div>

            {upcomingVisitDates.length > 0 && (
              <div className="col-span-2 lg:col-span-3">
                <h3 className={footerHeadingClass}>Opening hours</h3>
                <p className="mb-5 max-w-[22rem] text-[13px] leading-6 text-primary-foreground/65">
                  Contact us before travelling to book a test drive.
                </p>
                <ul className="space-y-3">
                  {(location === '/' ? upcomingVisitDates.slice(0, 1) : upcomingVisitDates).map((visit) => (
                    <li key={visit.date} className="flex items-center justify-between gap-4 border-b border-primary-foreground/10 pb-3 text-[14px]">
                      <span className="flex min-w-0 items-center gap-3">
                        <CalendarDays className="h-4 w-4 shrink-0 text-accent" />
                        <span className="min-w-0">
                          <span className="block font-bold text-primary-foreground">{visit.relativeLabel}</span>
                          <span className="block text-[12px] text-primary-foreground/60">{visit.relativeLabel === 'Today' || visit.relativeLabel === 'Tomorrow' ? visit.dateLabel : visit.dateLabel.replace(/^\S+\s/, '')}</span>
                        </span>
                      </span>
                      <span className="shrink-0 font-display text-[12px] font-bold tracking-normal text-primary-foreground">{visit.times}</span>
                    </li>
                  ))}
                </ul>
                {location === '/' && <Link href="/contact" className={`mt-3 inline-flex items-center gap-2 ${footerLinkClass}`}>Full opening hours <ArrowRight className="h-4 w-4" /></Link>}
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-between gap-6 border-t border-primary-foreground/10 pt-8 mt-12 text-[12px] font-bold text-primary-foreground/70 md:flex-row">
            <p>© {new Date().getFullYear()} {dealerConfig.legal.companyName || dealerConfig.identity.name}. All rights reserved.</p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
              {dealerConfig.legal.companyNumber && <span>CO {dealerConfig.legal.companyNumber}</span>}
              {dealerConfig.legal.vatNumber && <span>VAT {dealerConfig.legal.vatNumber}</span>}
              {dealerConfig.legal.termsUrl && <a className="transition-colors hover:text-primary-foreground" href={dealerConfig.legal.termsUrl}>TERMS</a>}
              {dealerConfig.legal.privacyUrl && <a className="transition-colors hover:text-primary-foreground" href={dealerConfig.legal.privacyUrl}>PRIVACY</a>}
            </div>
          </div>
        </div>
      </footer>
      <div data-home-scroll-spacer aria-hidden="true" className="bg-primary" />

      {!isCustomerTask && <CompareTray />}
    </div>
  );
}
