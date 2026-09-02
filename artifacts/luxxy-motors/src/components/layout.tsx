import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { Menu, X, Car as CarIcon, Phone, MessageCircle, ArrowRight, Instagram, Facebook, Twitter, MapPin, Heart } from 'lucide-react';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { getEnquiryHref } from '@/lib/cta-helpers';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CompareTray } from '@/components/compare-tray';

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
      <header ref={headerRef} data-site-header className={`fixed top-0 left-0 right-0 z-50 w-full transition-all duration-300 ${scrolled ? 'bg-background/95 backdrop-blur-md shadow-sm border-b' : 'bg-background/80 backdrop-blur-sm border-transparent'}`}>
        <div className="container mx-auto px-4 lg:px-8 h-[4.5rem] flex items-center justify-between">
          <button type="button" onClick={() => handleNav('top')} className="flex items-center gap-3 group">
            {dealerConfig.identity.logoAsset ? (
              <img src={dealerConfig.identity.logoAsset} alt={dealerConfig.identity.name} className="h-8 object-contain" />
            ) : (
              <>
                <div className="w-9 h-9 rounded bg-primary flex items-center justify-center text-primary-foreground group-hover:scale-105 transition-transform duration-300 shadow-sm">
                  <CarIcon className="w-5 h-5" />
                </div>
                <span className="font-bold text-lg sm:text-xl tracking-tight">
                  {dealerConfig.identity.logoText || dealerConfig.identity.name}
                </span>
              </>
            )}
          </button>

          {/* Desktop Nav */}
          <nav className="hidden xl:flex items-center gap-8 text-sm font-semibold">
            <button onClick={() => handleNav('top')} className="text-foreground/80 hover:text-primary transition-colors">Home</button>
            <button onClick={() => handleNav('stock')} className="text-foreground/80 hover:text-primary transition-colors">Stock</button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className="text-foreground/80 hover:text-primary transition-colors">Part Exchange</button>}
            {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className="text-foreground/80 hover:text-primary transition-colors">Warranty</button>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className="text-foreground/80 hover:text-primary transition-colors">Delivery</button>}
            <button onClick={() => handleNav('about')} className="text-foreground/80 hover:text-primary transition-colors">About Us</button>
            <button onClick={() => handleNav('visit')} className="text-foreground/80 hover:text-primary transition-colors">Contact</button>

            <div className="flex items-center gap-5 ml-2 pl-6 border-l">
              <div className="flex items-center gap-4 text-muted-foreground">
                {dealerConfig.contact.phone && (
                  <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-2 hover:text-primary transition-colors group">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center group-hover:bg-primary/10">
                      <Phone className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-bold text-foreground">{dealerConfig.contact.phone}</span>
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLocation('/saved')}
                aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'}
                data-testid="link-saved-cars"
                className="relative flex items-center gap-2 text-foreground/80 transition-colors hover:text-primary"
              >
                <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                  <Heart className={`h-4 w-4 text-primary ${savedCount > 0 ? 'fill-current' : ''}`} />
                  {savedCount > 0 && (
                    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold text-accent-foreground">
                      {savedCount}
                    </span>
                  )}
                </span>
                <span className="font-semibold">Saved</span>
              </button>
               <Button onClick={() => setLocation(getEnquiryHref('viewing'))} className="font-bold rounded-full px-6">
                 {dealerConfig.bookViewing.ctaLabel}
              </Button>
            </div>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="xl:hidden p-2 text-foreground/80 hover:text-foreground"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <div className="xl:hidden absolute top-[4.5rem] left-0 w-full bg-background border-b shadow-xl py-6 px-4 flex flex-col gap-2 max-h-[calc(100vh-4.5rem)] overflow-y-auto">
            <button onClick={() => handleNav('top')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors">Home</button>
            <button onClick={() => handleNav('stock')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors flex justify-between items-center">
              Browse Stock <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors">Part Exchange</button>}
            {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors">Warranty</button>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors">Delivery</button>}
            <button
              onClick={() => { setMobileMenuOpen(false); setLocation('/saved'); }}
              data-testid="link-saved-cars-mobile"
              className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors flex justify-between items-center"
            >
              <span className="flex items-center gap-2">
                <Heart className={`w-4 h-4 text-primary ${savedCount > 0 ? 'fill-current' : ''}`} />
                Saved Cars
              </span>
              {savedCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 font-mono text-[11px] font-bold text-accent-foreground">
                  {savedCount}
                </span>
              )}
            </button>
            <button onClick={() => handleNav('about')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors">Why Buy From Us</button>
            <button onClick={() => handleNav('visit')} className="text-left font-semibold p-3 hover:bg-secondary rounded-lg transition-colors">Contact & Location</button>

            <div className="mt-4 pt-4 border-t flex flex-col gap-3">
              {dealerConfig.contact.phone && (
                <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg text-foreground font-semibold">
                  <Phone className="w-5 h-5 text-primary" /> Call Us: {dealerConfig.contact.phone}
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg text-foreground font-semibold">
                  <MessageCircle className="w-5 h-5 text-green-600" /> WhatsApp Us
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
                <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center text-white shadow-sm">
                  <CarIcon className="w-6 h-6" />
                </div>
                <span className="font-bold text-2xl tracking-tight text-white">
                  {dealerConfig.identity.logoText || dealerConfig.identity.name}
                </span>
              </div>
              <p className="text-primary-foreground/70 mb-8 leading-relaxed max-w-sm">
                {dealerConfig.hero.subcopy}
              </p>
              <div className="flex items-center gap-4">
                {dealerConfig.social.instagram && (
                  <a href={dealerConfig.social.instagram} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-accent hover:text-primary transition-all">
                    <Instagram className="w-4 h-4" />
                  </a>
                )}
                {dealerConfig.social.facebook && (
                  <a href={dealerConfig.social.facebook} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-accent hover:text-primary transition-all">
                    <Facebook className="w-4 h-4" />
                  </a>
                )}
                {dealerConfig.social.twitter && (
                  <a href={dealerConfig.social.twitter} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-accent hover:text-primary transition-all">
                    <Twitter className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            <div className="lg:col-span-2">
              <h3 className="font-bold text-lg mb-6 text-white">Vehicles</h3>
              <nav className="flex flex-col items-start gap-3 text-sm text-primary-foreground/70">
                <button onClick={() => handleNav('stock')} className="hover:text-accent transition-colors">View All Stock</button>
                <button onClick={() => handleNav('part-exchange')} className="hover:text-accent transition-colors">Part Exchange</button>
                  <button onClick={() => setLocation(getEnquiryHref('viewing'))} className="hover:text-accent transition-colors">{dealerConfig.bookViewing.ctaLabel}</button>
                <button onClick={() => handleNav('warranty')} className="hover:text-accent transition-colors">Warranty Information</button>
              </nav>
            </div>

            <div className="lg:col-span-3">
              <h3 className="font-bold text-lg mb-6 text-white">Contact & Visit</h3>
              <div className="space-y-4 text-sm text-primary-foreground/70">
                {dealerConfig.contact.phone && (
                  <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-3 hover:text-accent transition-colors">
                    <Phone className="w-4 h-4 text-accent" /> {dealerConfig.contact.phone}
                  </a>
                )}
                {dealerConfig.contact.email && (
                  <a href={`mailto:${dealerConfig.contact.email}`} className="flex items-center gap-3 hover:text-accent transition-colors">
                    <MessageCircle className="w-4 h-4 text-accent" /> {dealerConfig.contact.email}
                  </a>
                )}
                {dealerConfig.address && (
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-accent shrink-0 mt-1" />
                    <address className="not-italic space-y-1">
                      {dealerConfig.address.street && <p>{dealerConfig.address.street}</p>}
                      {dealerConfig.address.city && <p>{dealerConfig.address.city}</p>}
                      {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
                      {dealerConfig.address.mapsUrl && (
                        <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-block mt-1">
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
                <h3 className="font-bold text-lg mb-6 text-white">Opening Hours</h3>
                <ul className="text-sm text-primary-foreground/70 space-y-3">
                  {dealerConfig.hours.map((h, i) => (
                    <li key={i} className="flex justify-between border-b border-white/10 pb-2">
                      <span className="font-medium">{h.days}</span>
                      <span>{h.times}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-6 text-xs text-primary-foreground/50">
            <p>© {new Date().getFullYear()} {dealerConfig.legal.companyName || dealerConfig.identity.name}. All rights reserved.</p>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              {dealerConfig.legal.companyNumber && <span>Company No: {dealerConfig.legal.companyNumber}</span>}
              {dealerConfig.legal.vatNumber && <span>VAT: {dealerConfig.legal.vatNumber}</span>}
              {dealerConfig.legal.termsUrl && <a className="hover:text-white transition-colors" href={dealerConfig.legal.termsUrl}>Terms &amp; Conditions</a>}
              {dealerConfig.legal.privacyUrl && <a className="hover:text-white transition-colors" href={dealerConfig.legal.privacyUrl}>Privacy Policy</a>}
            </div>
          </div>
        </div>
      </footer>
      <div data-home-scroll-spacer aria-hidden="true" className="bg-primary" />

      <CompareTray />
    </div>
  );
}
