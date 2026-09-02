import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { Menu, X, Car as CarIcon, Phone, MessageCircle, ArrowRight, Instagram, Facebook, Twitter, MapPin, Heart } from 'lucide-react';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { getEnquiryHref } from '@/lib/cta-helpers';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CompareTray } from '@/components/compare-tray';

// Chrome shares the showroom type scale: compact uppercase for navigation,
// monospaced figures for anything the customer might read back to us.
const navLinkClass =
  'whitespace-nowrap text-[12px] font-bold uppercase tracking-[.08em] text-muted-foreground transition-colors hover:text-accent';
const mobileNavRowClass =
  'flex items-center justify-between border-b border-border/60 py-3.5 text-left text-[12px] font-bold uppercase tracking-[.1em] text-foreground/80 transition-colors hover:text-accent';
const footerLinkClass =
  'text-[13px] font-semibold text-primary-foreground/70 transition-colors hover:text-accent';
const footerHeadingClass = 'luxxy-label border-b border-primary-foreground/15 pb-3 text-accent';
const socialLinkClass =
  'grid h-10 w-10 place-items-center border border-primary-foreground/20 bg-primary-foreground/5 text-primary-foreground/80 transition-colors hover:border-accent hover:bg-accent hover:text-primary';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { settings: dealerConfig } = useDealerSettings();
  const { savedCount } = useSavedCars();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const brandStyle = {
    ...(dealerConfig.identity.brandColors?.primaryHsl
      ? { '--primary': dealerConfig.identity.brandColors.primaryHsl }
      : {}),
    ...(dealerConfig.identity.brandColors?.accentHsl
      ? { '--accent': dealerConfig.identity.brandColors.accentHsl }
      : {}),
  } as CSSProperties;
  const wordmark = dealerConfig.identity.logoText || dealerConfig.identity.name;
  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(' · ');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
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

  return (
    <div style={brandStyle} className="min-h-[100dvh] flex flex-col bg-background font-sans text-foreground">
      <header ref={headerRef} data-site-header className={`fixed top-0 left-0 right-0 z-50 w-full border-b transition-colors duration-300 ${scrolled ? 'border-border bg-background/95 backdrop-blur-md' : 'border-transparent bg-background/80 backdrop-blur-sm'}`}>
        <div className="container mx-auto px-4 lg:px-8 h-[4.5rem] flex items-center justify-between gap-4">
          <button type="button" onClick={() => handleNav('top')} className="flex items-center gap-3 text-left group">
            {dealerConfig.identity.logoAsset ? (
              <img src={dealerConfig.identity.logoAsset} alt={dealerConfig.identity.name} className="h-8 object-contain" />
            ) : (
              <>
                <span className="grid h-9 w-9 shrink-0 place-items-center bg-primary text-primary-foreground transition-colors duration-300 group-hover:bg-accent group-hover:text-accent-foreground">
                  <CarIcon className="w-5 h-5" />
                </span>
                <span className="leading-none">
                  <span className="block whitespace-nowrap font-display text-lg font-semibold tracking-[-.02em] text-primary sm:text-xl">
                    {wordmark}
                  </span>
                  {locationLabel && (
                    <span className="luxxy-label mt-1.5 block text-muted-foreground">{locationLabel}</span>
                  )}
                </span>
              </>
            )}
          </button>

          {/* Desktop Nav */}
          <nav className="hidden xl:flex items-center gap-5 2xl:gap-7">
            <button onClick={() => handleNav('top')} className={navLinkClass}>Home</button>
            <button onClick={() => handleNav('stock')} className={navLinkClass}>Stock</button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className={navLinkClass}>Part Exchange</button>}
            {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className={navLinkClass}>Warranty</button>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className={navLinkClass}>Delivery</button>}
            <button onClick={() => handleNav('about')} className={navLinkClass}>About Us</button>
            <button onClick={() => handleNav('visit')} className={navLinkClass}>Contact</button>

            <div className="flex items-center gap-4 ml-1 pl-5 border-l border-border 2xl:gap-5 2xl:pl-6">
              {dealerConfig.contact.phone && (
                <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="group flex items-center gap-2.5">
                  <Phone className="h-4 w-4 shrink-0 text-accent" />
                  <span className="whitespace-nowrap font-mono text-[13px] font-bold text-primary transition-colors group-hover:text-accent">
                    {dealerConfig.contact.phone}
                  </span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setLocation('/saved')}
                aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'}
                data-testid="link-saved-cars"
                className={`group flex items-center gap-2.5 ${navLinkClass}`}
              >
                <span className="relative grid h-8 w-8 place-items-center border border-border bg-secondary/50 transition-colors group-hover:border-accent/60">
                  <Heart className={`h-4 w-4 text-accent ${savedCount > 0 ? 'fill-current' : ''}`} />
                  {savedCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center bg-accent px-1 font-mono text-[10px] font-bold text-accent-foreground">
                      {savedCount}
                    </span>
                  )}
                </span>
                <span className="hidden 2xl:inline">Saved</span>
              </button>
               <Button
                 onClick={() => setLocation(getEnquiryHref('viewing'))}
                 className="h-11 rounded-none px-4 text-[12px] font-bold uppercase tracking-[.08em] shadow-none 2xl:px-5"
               >
                 {dealerConfig.bookViewing.ctaLabel}
              </Button>
            </div>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="xl:hidden grid h-10 w-10 place-items-center border border-border text-foreground/80 transition-colors hover:border-primary/45 hover:text-primary"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <div className="xl:hidden absolute top-[4.5rem] left-0 w-full border-y border-border bg-background px-4 pb-6 pt-2 flex flex-col max-h-[calc(100vh-4.5rem)] overflow-y-auto lg:px-8">
            <button onClick={() => handleNav('top')} className={mobileNavRowClass}>Home</button>
            <button onClick={() => handleNav('stock')} className={mobileNavRowClass}>
              Browse Stock <ArrowRight className="w-4 h-4 text-accent" />
            </button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className={mobileNavRowClass}>Part Exchange</button>}
            {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className={mobileNavRowClass}>Warranty</button>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className={mobileNavRowClass}>Delivery</button>}
            <button
              onClick={() => { setMobileMenuOpen(false); setLocation('/saved'); }}
              data-testid="link-saved-cars-mobile"
              className={mobileNavRowClass}
            >
              <span className="flex items-center gap-2">
                <Heart className={`w-4 h-4 text-accent ${savedCount > 0 ? 'fill-current' : ''}`} />
                Saved Cars
              </span>
              {savedCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center bg-accent px-1.5 font-mono text-[11px] font-bold text-accent-foreground">
                  {savedCount}
                </span>
              )}
            </button>
            <button onClick={() => handleNav('about')} className={mobileNavRowClass}>Why Buy From Us</button>
            <button onClick={() => handleNav('visit')} className={mobileNavRowClass}>Contact & Location</button>

            <div className="mt-5 flex flex-col gap-2">
              {dealerConfig.contact.phone && (
                <a
                  href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}
                  className="flex items-baseline gap-2.5 border border-border bg-secondary/40 px-4 py-3.5 transition-colors hover:border-accent/60"
                >
                  <Phone className="h-4 w-4 shrink-0 translate-y-0.5 text-accent" />
                  <span className="luxxy-label shrink-0 text-muted-foreground">Call us</span>
                  <span className="luxxy-leader" aria-hidden="true" />
                  <span className="shrink-0 font-mono text-[13px] font-bold text-primary">{dealerConfig.contact.phone}</span>
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a
                  href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-baseline gap-2.5 border border-border bg-secondary/40 px-4 py-3.5 transition-colors hover:border-accent/60"
                >
                  <MessageCircle className="h-4 w-4 shrink-0 translate-y-0.5 text-[#1f7a4d]" />
                  <span className="luxxy-label shrink-0 text-muted-foreground">Message us</span>
                  <span className="luxxy-leader" aria-hidden="true" />
                  <span className="shrink-0 font-mono text-[13px] font-bold text-primary">WhatsApp</span>
                </a>
              )}
            </div>
          </div>
        )}
      </header>

      <main className={`flex-1 w-full ${location === '/' ? '' : 'pt-[var(--site-header-height)]'}`}>
        {children}
      </main>

      <footer id="contact" data-home-section className="bg-primary text-primary-foreground pt-20 pb-10 mt-auto border-t-4 border-accent">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-12 lg:gap-8 mb-16">
            <div className="lg:col-span-4">
              <div className="flex items-center gap-3 mb-6">
                <span className="grid h-10 w-10 shrink-0 place-items-center border border-accent/60 bg-accent/15 text-accent">
                  <CarIcon className="w-5 h-5" />
                </span>
                <span className="leading-none">
                  <span className="block font-display text-2xl font-semibold tracking-[-.02em] text-primary-foreground">
                    {wordmark}
                  </span>
                  {locationLabel && (
                    <span className="luxxy-label mt-2 block text-primary-foreground/55">{locationLabel}</span>
                  )}
                </span>
              </div>
              <p className="text-primary-foreground/70 mb-8 text-sm leading-7 max-w-sm">
                {dealerConfig.hero.subcopy}
              </p>
              <div className="flex items-center gap-2">
                {dealerConfig.social.instagram && (
                  <a href={dealerConfig.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className={socialLinkClass}>
                    <Instagram className="w-4 h-4" />
                  </a>
                )}
                {dealerConfig.social.facebook && (
                  <a href={dealerConfig.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className={socialLinkClass}>
                    <Facebook className="w-4 h-4" />
                  </a>
                )}
                {dealerConfig.social.twitter && (
                  <a href={dealerConfig.social.twitter} target="_blank" rel="noopener noreferrer" aria-label="Twitter" className={socialLinkClass}>
                    <Twitter className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              <h3 className={footerHeadingClass}>Vehicles</h3>
              <nav className="mt-5 flex flex-col items-start gap-3">
                <button onClick={() => handleNav('stock')} className={footerLinkClass}>View All Stock</button>
                <button onClick={() => handleNav('part-exchange')} className={footerLinkClass}>Part Exchange</button>
                  <button onClick={() => setLocation(getEnquiryHref('viewing'))} className={footerLinkClass}>{dealerConfig.bookViewing.ctaLabel}</button>
                <button onClick={() => handleNav('warranty')} className={footerLinkClass}>Warranty Information</button>
              </nav>
            </div>

            <div className="lg:col-span-3">
              <h3 className={footerHeadingClass}>Contact &amp; Visit</h3>
              <div className="mt-5 space-y-4 text-[13px] text-primary-foreground/70">
                {dealerConfig.contact.phone && (
                  <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="group flex items-center gap-3 transition-colors hover:text-accent">
                    <Phone className="w-4 h-4 shrink-0 text-accent" />
                    <span className="font-mono text-[13px] font-bold text-primary-foreground group-hover:text-accent">{dealerConfig.contact.phone}</span>
                  </a>
                )}
                {dealerConfig.contact.email && (
                  <a href={`mailto:${dealerConfig.contact.email}`} className="flex items-center gap-3 font-semibold transition-colors hover:text-accent">
                    <MessageCircle className="w-4 h-4 shrink-0 text-accent" /> {dealerConfig.contact.email}
                  </a>
                )}
                {dealerConfig.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-accent shrink-0 mt-1" />
                    <address className="not-italic space-y-1 leading-6">
                      {dealerConfig.address.street && <p>{dealerConfig.address.street}</p>}
                      {dealerConfig.address.city && <p>{dealerConfig.address.city}</p>}
                      {dealerConfig.address.postcode && <p className="font-mono font-bold text-primary-foreground">{dealerConfig.address.postcode}</p>}
                      {dealerConfig.address.mapsUrl && (
                        <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer" className="luxxy-label mt-3 inline-block text-accent transition-colors hover:text-primary-foreground">
                          Get Directions &rarr;
                        </a>
                      )}
                    </address>
                  </div>
                )}
              </div>
            </div>

            {dealerConfig.hours && dealerConfig.hours.length > 0 && (
              <div className="lg:col-span-3">
                <h3 className={footerHeadingClass}>Opening Hours</h3>
                <ul className="mt-5 space-y-3">
                  {dealerConfig.hours.map((h, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[13px]">
                      <span className="shrink-0 text-primary-foreground/70">{h.days}</span>
                      <span className="luxxy-leader opacity-25" aria-hidden="true" />
                      <span className="shrink-0 font-mono text-[13px] font-bold text-primary-foreground">{h.times}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-primary-foreground/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-6 text-primary-foreground/50">
            <p className="luxxy-label text-primary-foreground/45">© {new Date().getFullYear()} {dealerConfig.legal.companyName || dealerConfig.identity.name}. All rights reserved.</p>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[11px]">
              {dealerConfig.legal.companyNumber && <span className="font-mono">Company No: {dealerConfig.legal.companyNumber}</span>}
              {dealerConfig.legal.vatNumber && <span className="font-mono">VAT: {dealerConfig.legal.vatNumber}</span>}
              {dealerConfig.legal.termsUrl && <a className="luxxy-label transition-colors hover:text-accent" href={dealerConfig.legal.termsUrl}>Terms &amp; Conditions</a>}
              {dealerConfig.legal.privacyUrl && <a className="luxxy-label transition-colors hover:text-accent" href={dealerConfig.legal.privacyUrl}>Privacy Policy</a>}
            </div>
          </div>
        </div>
      </footer>
      <div data-home-scroll-spacer aria-hidden="true" className="bg-primary" />

      <CompareTray />
    </div>
  );
}
