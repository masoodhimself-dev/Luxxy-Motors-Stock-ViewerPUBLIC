import { websiteText } from "@/lib/website-content";
import { DealerWordmark } from "@/components/brand/wordmark";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { Menu, X, Phone, MessageCircle, ArrowRight, Heart, CalendarDays } from 'lucide-react';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { getEnquiryHref } from '@/lib/cta-helpers';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useStockHeader } from '@/hooks/use-stock-header';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CompareTray } from '@/components/compare-tray';
import { CustomerChat } from '@/components/customer-chat';
import { isWritableFormControl } from '@/lib/form-draft';
import { formatPhoneDisplay } from '@/lib/utils';
import { CustomerFooter } from '@/components/customer-footer';
import './premium-showroom.css';
import './stock-browsing-header.css';
import './portal/portal-workspace.css';
import { readableAccentForHsl, readableForegroundForHsl } from '@/lib/brand-colour';
import { customerThemeVariables } from '@/lib/customer-theme';
export { readableForegroundForHsl } from '@/lib/brand-colour';

const navLinkClass =
  'inline-flex min-h-11 items-center whitespace-nowrap font-display text-[14px] font-semibold tracking-normal text-primary/75 transition-colors hover:text-accent';
const mobileNavRowClass =
  'flex min-h-12 items-center justify-between border-b border-primary/10 py-2 text-left font-display text-base font-semibold text-primary transition-colors hover:text-accent';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [, vehicleRoute] = useRoute('/vehicle/:id');
  const testDriveHref = vehicleRoute?.id ? `/enquire?type=viewing&vehicleId=${encodeURIComponent(vehicleRoute.id)}` : getEnquiryHref('viewing');
  const isStaff = location.startsWith('/portal');
  const isCustomerTask = /^\/(sign|customer-details|viewing|my-purchase)\//.test(location);
  const isPremiumShowroom = location === '/' || location === '/stock' || /^\/vehicle\/[^/]+\/?$/.test(location);
  const isBrowsingPage = location === '/stock' || /^\/vehicle\/[^/]+\/?$/.test(location);
  const { settings: dealerConfig } = useDealerSettings();
  const { savedCount } = useSavedCars();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const darkHomeHeader = location === '/' && !scrolled && !mobileMenuOpen;
  const headerLogo = darkHomeHeader
    ? dealerConfig.presentation?.footerLogoUrl || dealerConfig.identity.logoAsset
    : dealerConfig.identity.logoAsset;
  const headerRef = useRef<HTMLElement>(null);
  const stockHeader = useStockHeader(isBrowsingPage, mobileMenuOpen, headerRef, location);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const hasEditedFormRef = useRef(false);

  // Adopt the current palette for the original template defaults; preserve bespoke colours.
  const brandPrimary = dealerConfig.identity.brandColors?.primaryHsl === '161.538 16.883% 15.098%' ? '195 22% 13%' : dealerConfig.identity.brandColors?.primaryHsl;
  const brandAccent = dealerConfig.identity.brandColors?.accentHsl === '30.000 40.659% 35.686%' ? '190 86% 44%' : dealerConfig.identity.brandColors?.accentHsl;
  const customerAccent = readableAccentForHsl(brandAccent && !['190 86% 44%', '42 82% 49%'].includes(brandAccent) ? brandAccent : '203.226 58.491% 31.176%');
  const accent = isStaff ? brandAccent : customerAccent;
  const brandStyle = useMemo(() => ({
    '--premium-accent': `hsl(${customerAccent})`,
    '--premium-accent-foreground': `hsl(${readableForegroundForHsl(customerAccent)})`,
    ...(isStaff ? Object.fromEntries(([ ["pageColour", "--dealer-page"], ["panelColour", "--dealer-panel"], ["headingColour", "--dealer-heading"], ["linkColour", "--dealer-link"] ] as const).flatMap(([key, variable]) => { const value = dealerConfig.presentation?.[key]; return value && /^#[0-9a-fA-F]{6}$/.test(value) ? [[variable, value]] : []; })) : {}),
    ...(brandPrimary
      ? {
          '--dealer-primary': brandPrimary,
          '--dealer-primary-foreground': readableForegroundForHsl(brandPrimary),
          '--primary': brandPrimary,
          '--primary-foreground': readableForegroundForHsl(brandPrimary),
        }
      : {}),
    ...(accent
      ? {
          '--dealer-accent': accent,
          '--dealer-accent-foreground': readableForegroundForHsl(accent),
          '--accent': accent,
          '--accent-foreground': readableForegroundForHsl(accent),
        }
      : {}),
    ...(!isStaff ? customerThemeVariables({ ...dealerConfig.presentation, primaryHsl: brandPrimary, accentHsl: customerAccent }) : {}),
  }) as CSSProperties, [brandPrimary, accent, customerAccent, dealerConfig.presentation, isStaff]);

  useEffect(() => {
    if (isStaff) return;
    // Radix menus and dialogs live beneath body rather than the showroom shell.
    // Carry the same dealer palette there, then restore it on staff routes.
    const entries = Object.entries(brandStyle) as [string, string][];
    const previous = entries.map(([key]) => [key, document.body.style.getPropertyValue(key)] as const);
    for (const [key, value] of entries) document.body.style.setProperty(key, value);
    return () => {
      for (const [key, value] of previous) {
        if (value) document.body.style.setProperty(key, value);
        else document.body.style.removeProperty(key);
      }
    };
  }, [brandStyle, isStaff]);

  useEffect(() => {
    const url = dealerConfig.presentation?.faviconUrl;
    if (!url || !/^https:\/\//.test(url)) return;
    const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = url;
    document.head.appendChild(icon);
    return () => icon.remove();
  }, [dealerConfig.presentation?.faviconUrl]);


  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
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
    if (target === 'part-exchange' || target === 'delivery') { setLocation(`/enquire?type=${target === 'part-exchange' ? 'part_exchange' : 'delivery'}`); return; }
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
    <div style={brandStyle} className={`luxxy-shell min-h-[100dvh] flex flex-col bg-background font-sans text-foreground${isPremiumShowroom ? ' premium-showroom' : ''}${isStaff ? ' premium-portal' : ' customer-site'}`}>
      <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-24 rounded-md bg-primary px-5 py-3 text-primary-foreground focus:translate-y-0">Skip to content</a>
      <header
        ref={headerRef}
        data-site-header
        data-scroll-hidden={stockHeader.hidden}
        onFocusCapture={stockHeader.reveal}
        className={`fixed top-0 left-0 right-0 z-50 w-full border-b transition-all duration-300 ${isBrowsingPage ? 'stock-browsing-header' : ''} ${darkHomeHeader ? "stock-home-header" : ""} ${
          scrolled
            ? 'border-primary/15 bg-background shadow-none'
            : 'border-primary/10 bg-background'
        }`}
      >
        <div className="site-header-inner container mx-auto flex h-[4.75rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={handleLogoClick} className="site-header-brand flex min-w-0 items-center gap-3 text-left group" aria-label={`${dealerConfig.identity.name || 'Our dealership'} home`}>
            <DealerWordmark {...dealerConfig.identity} logoAsset={headerLogo} className="text-primary" />
          </button>

          {isStaff ? <Button variant="outline" className="shrink-0 px-3 text-xs" onClick={() => handleNav('top')}>View showroom <ArrowRight className="h-4 w-4" /></Button> : <>
          {/* Desktop Nav - Condensed */}
          <nav className="site-header-nav hidden items-center gap-4 lg:flex 2xl:hidden" aria-label="Primary navigation">
            <button onClick={() => handleNav('stock')} className={navLinkClass}>{websiteText(dealerConfig, "navigationStock")}</button>
            {dealerConfig.contact.phone && <a className={navLinkClass} href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}><Phone className="mr-2 h-4 w-4" aria-hidden="true" />{formatPhoneDisplay(dealerConfig.contact.phone)}</a>}
            {dealerConfig.warranty?.enabled && <Link href="/warranty" aria-current={location === '/warranty' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>Warranty</Link>}
            <Link href="/contact" aria-current={location === '/contact' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>{websiteText(dealerConfig, "navigationContact")}</Link>
            <button
              type="button"
              onClick={() => setLocation('/saved')}
              aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'}
              data-testid="link-saved-cars-condensed"
              className="relative flex h-11 min-w-11 items-center justify-center gap-2 font-display text-[13px] font-bold tracking-normal text-primary/80 transition-colors hover:text-accent"
            >
              <Heart className={`h-5 w-5 ${savedCount > 0 ? 'text-accent fill-current' : ''}`} />
              {savedCount > 0 && (
                <span className="absolute -top-2 -right-2.5 bg-accent text-accent-foreground text-[10px] font-semibold px-1.5 min-w-[20px] text-center h-5 flex items-center justify-center rounded-md shadow-none">
                  {savedCount}
                </span>
              )}
            </button>
            <Button
              onClick={() => setLocation(testDriveHref)}
              className="h-11 px-4 font-display text-[13px] font-bold tracking-normal bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground rounded-md shadow-none transition-all"
            >
              {dealerConfig.bookViewing.ctaLabel}
            </Button>
          </nav>

          {/* Desktop Nav - Full */}
          <nav className="site-header-nav hidden 2xl:flex items-center gap-6" aria-label="Primary navigation">
            <button onClick={() => handleNav('stock')} className={navLinkClass}>{websiteText(dealerConfig, "navigationStock")}</button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className={navLinkClass}>{websiteText(dealerConfig, "navigationPartExchange")}</button>}
            {dealerConfig.warranty?.enabled && <Link href="/warranty" aria-current={location === '/warranty' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>Warranty</Link>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className={navLinkClass}>Delivery</button>}
            <Link href="/contact" aria-current={location === '/contact' ? 'page' : undefined} className={`inline-flex min-h-11 items-center ${navLinkClass}`}>{websiteText(dealerConfig, "navigationContact")}</Link>

            <div className="flex items-center gap-4 pl-6 border-l border-primary/10">
              {dealerConfig.contact.phone && (
                <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="group flex min-h-11 items-center gap-2">
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
                 onClick={() => setLocation(testDriveHref)}
                 className="h-11 px-6 font-display text-[13px] font-bold tracking-normal bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground rounded-md shadow-none transition-all"
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

        {!isStaff && dealerConfig.contact.phone && <div className="header-phone-row lg:hidden"><a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}><Phone size={16} aria-hidden="true" />{formatPhoneDisplay(dealerConfig.contact.phone)}</a></div>}

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <nav id="mobile-navigation" ref={mobileMenuRef} aria-label="Mobile navigation" onBlur={(event) => {
            const nextFocus = event.relatedTarget;
            if (!nextFocus || (!event.currentTarget.contains(nextFocus) && nextFocus !== menuButtonRef.current)) setMobileMenuOpen(false);
          }} className="lg:hidden absolute left-0 top-full flex max-h-[calc(100dvh-var(--site-header-height))] w-full flex-col overflow-y-auto border-b border-primary/15 bg-background px-4 pb-8 pt-4 shadow-none">
            <button onClick={() => handleNav('top')} className={mobileNavRowClass}>Home <ArrowRight className="w-5 h-5 opacity-40" /></button>
            <button onClick={() => handleNav('stock')} className={mobileNavRowClass}>{websiteText(dealerConfig, "navigationStock")} <ArrowRight className="w-5 h-5 text-accent" />
            </button>
            <button onClick={() => { setMobileMenuOpen(false); setLocation(testDriveHref); }} className={mobileNavRowClass}>{dealerConfig.bookViewing.ctaLabel} <CalendarDays className="h-5 w-5 text-accent" /></button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className={mobileNavRowClass}>{websiteText(dealerConfig, "navigationPartExchange")} <ArrowRight className="w-5 h-5 opacity-40" /></button>}
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
            <Link href="/contact" onClick={() => setMobileMenuOpen(false)} aria-current={location === '/contact' ? 'page' : undefined} className={mobileNavRowClass}>{websiteText(dealerConfig, "navigationContact")} <ArrowRight className="w-5 h-5 opacity-40" /></Link>

            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
              {dealerConfig.contact.phone && (
                <a
                  href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}
                  className="flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-primary hover:bg-secondary"
                >
                  <span className="flex items-center gap-2 text-sm font-medium"><Phone className="h-4 w-4" /> Call us</span>
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a
                  href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-primary hover:bg-secondary"
                >
                  <span className="flex items-center gap-2 text-sm font-medium"><MessageCircle className="h-4 w-4" /> WhatsApp</span>
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
            <div><p className="font-semibold">{dealerConfig.identity.name}</p><p className="mt-1 text-muted-foreground">Need help with your documents or visit? Talk to us.</p></div>
            <div className="flex flex-wrap items-center gap-x-5">
              {dealerConfig.contact.phone && <a className="text-link min-h-11" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>{formatPhoneDisplay(dealerConfig.contact.phone)}</a>}
              {dealerConfig.contact.email && <a className="text-link min-h-11 break-all" href={`mailto:${dealerConfig.contact.email}`}>Email us</a>}
              {dealerConfig.legal.privacyUrl && <a className="text-link min-h-11" href={dealerConfig.legal.privacyUrl}>Privacy</a>}
            </div>
          </div>
        </footer>
      )}
      {!isStaff && !isCustomerTask && <CustomerFooter settings={dealerConfig} testDriveHref={testDriveHref} />}
      <div data-home-scroll-spacer aria-hidden="true" className="bg-primary" />

      {!isCustomerTask && <CompareTray />}
      {!isStaff && !isCustomerTask && <CustomerChat />}
    </div>
  );
}
