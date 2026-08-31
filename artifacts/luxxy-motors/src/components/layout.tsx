import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { Menu, X, Car as CarIcon, Phone, MessageCircle, Calendar, Search } from 'lucide-react';
import { dealerConfig } from '@/config/dealer';
import { navigateToHomeTarget } from '@/lib/home-navigation';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
      <header ref={headerRef} className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <button type="button" onClick={() => handleNav('top')} className="flex items-center gap-2 group">
            {dealerConfig.identity.logoAsset ? (
              <img src={dealerConfig.identity.logoAsset} alt={dealerConfig.identity.name} className="h-8 object-contain" />
            ) : (
              <>
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground group-hover:scale-105 transition-transform">
                  <CarIcon className="w-5 h-5" />
                </div>
                <span className="font-bold text-base sm:text-xl tracking-tight">
                  {dealerConfig.identity.logoText || dealerConfig.identity.name}
                </span>
              </>
            )}
          </button>

          {/* Desktop Nav */}
          <nav className="hidden xl:flex items-center gap-6 text-sm font-medium">
            <button onClick={() => handleNav('top')} className="hover:text-primary transition-colors">Home</button>
            <button onClick={() => handleNav('stock')} className="hover:text-primary transition-colors">Stock</button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className="hover:text-primary transition-colors">Part Exchange</button>}
            {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className="hover:text-primary transition-colors">Warranty</button>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className="hover:text-primary transition-colors">Delivery</button>}
            <button onClick={() => handleNav('about')} className="hover:text-primary transition-colors">About Us</button>
            <button onClick={() => handleNav('visit')} className="hover:text-primary transition-colors">Contact</button>

            <div className="flex items-center gap-4 ml-4 pl-4 border-l">
              {dealerConfig.contact.phone && (
                <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                  <Phone className="w-4 h-4" /> {dealerConfig.contact.phone}
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-primary transition-colors">
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </a>
              )}
              <button type="button" onClick={() => handleNav('book-viewing')} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors">
                Book a Viewing
              </button>
            </div>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="xl:hidden p-2"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <div className="xl:hidden absolute top-16 left-0 w-full bg-background border-b shadow-lg py-4 px-4 flex flex-col gap-4">
            <button onClick={() => handleNav('top')} className="text-left font-medium p-2 hover:bg-muted rounded">Home</button>
            <button onClick={() => handleNav('stock')} className="text-left font-medium p-2 hover:bg-muted rounded">Stock</button>
            {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className="text-left font-medium p-2 hover:bg-muted rounded">Part Exchange</button>}
            {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className="text-left font-medium p-2 hover:bg-muted rounded">Warranty</button>}
            {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className="text-left font-medium p-2 hover:bg-muted rounded">Delivery</button>}
            <button onClick={() => handleNav('about')} className="text-left font-medium p-2 hover:bg-muted rounded">About Us</button>
            <button onClick={() => handleNav('visit')} className="text-left font-medium p-2 hover:bg-muted rounded">Contact</button>
          </div>
        )}
      </header>

      <main className="flex-1 w-full pb-20 xl:pb-0">
        {children}
      </main>

      <footer id="contact" data-home-section className="border-t bg-card py-16 mt-auto">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-bold text-lg mb-4">{dealerConfig.identity.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {dealerConfig.hero.subcopy}
              </p>
              <div className="flex flex-col gap-2 text-sm">
                {dealerConfig.contact.phone && <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="hover:text-primary">{dealerConfig.contact.phone}</a>}
                {dealerConfig.contact.email && <a href={`mailto:${dealerConfig.contact.email}`} className="hover:text-primary">{dealerConfig.contact.email}</a>}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-4">Explore</h3>
              <nav className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                <button onClick={() => handleNav('stock')} className="hover:text-primary">Stock</button>
                {dealerConfig.partExchange?.enabled && <button onClick={() => handleNav('part-exchange')} className="hover:text-primary">Part Exchange</button>}
                {dealerConfig.warranty?.enabled && <button onClick={() => handleNav('warranty')} className="hover:text-primary">Warranty</button>}
                {dealerConfig.delivery?.enabled && <button onClick={() => handleNav('delivery')} className="hover:text-primary">Delivery</button>}
                <button onClick={() => handleNav('about')} className="hover:text-primary">About</button>
                <button onClick={() => handleNav('visit')} className="hover:text-primary">Contact</button>
              </nav>
            </div>

            {dealerConfig.address && (dealerConfig.address.street || dealerConfig.address.city) && (
              <div>
                <h3 className="font-bold text-lg mb-4">Visit Us</h3>
                <address className="not-italic text-sm text-muted-foreground space-y-1">
                  {dealerConfig.address.street && <p>{dealerConfig.address.street}</p>}
                  {dealerConfig.address.city && <p>{dealerConfig.address.city}</p>}
                  {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
                </address>
                {dealerConfig.address.mapsUrl && (
                  <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline mt-2 inline-block">
                    View on Map
                  </a>
                )}
              </div>
            )}

            {dealerConfig.hours && dealerConfig.hours.length > 0 && (
              <div>
                <h3 className="font-bold text-lg mb-4">Opening Hours</h3>
                <ul className="text-sm text-muted-foreground space-y-2">
                  {dealerConfig.hours.map((h, i) => (
                    <li key={i} className="flex gap-4"><span className="w-20">{h.days}</span> <span>{h.times}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t pt-8 text-center text-sm text-muted-foreground flex flex-col md:flex-row justify-between items-center gap-4">
            <p>© {new Date().getFullYear()} {dealerConfig.legal.companyName || dealerConfig.identity.name}.</p>
            <div className="flex flex-wrap justify-center gap-4">
              {dealerConfig.legal.companyNumber && <span>Company No: {dealerConfig.legal.companyNumber}</span>}
              {dealerConfig.legal.vatNumber && <span>VAT: {dealerConfig.legal.vatNumber}</span>}
              {dealerConfig.legal.termsUrl && <a className="hover:text-primary" href={dealerConfig.legal.termsUrl}>Terms &amp; Conditions</a>}
              {dealerConfig.legal.privacyUrl && <a className="hover:text-primary" href={dealerConfig.legal.privacyUrl}>Privacy Policy</a>}
              {dealerConfig.legal.cookieUrl && <a className="hover:text-primary" href={dealerConfig.legal.cookieUrl}>Cookie Policy</a>}
              {dealerConfig.social.instagram && <a className="hover:text-primary" href={dealerConfig.social.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>}
              {dealerConfig.social.facebook && <a className="hover:text-primary" href={dealerConfig.social.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>}
              {dealerConfig.social.twitter && <a className="hover:text-primary" href={dealerConfig.social.twitter} target="_blank" rel="noopener noreferrer">X</a>}
            </div>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Bar */}
      <div className="xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border pb-safe">
        <div className="flex items-center justify-between px-2 py-2">
          {dealerConfig.contact.phone && (
            <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="flex flex-col items-center justify-center w-full py-2 text-muted-foreground hover:text-foreground">
              <Phone className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-medium uppercase tracking-wider">Call</span>
            </a>
          )}
          {dealerConfig.contact.whatsapp && (
            <a href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center w-full py-2 text-muted-foreground hover:text-foreground">
              <MessageCircle className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-medium uppercase tracking-wider">WhatsApp</span>
            </a>
          )}
          <button onClick={() => handleNav('stock')} className="flex flex-col items-center justify-center w-full py-2 text-primary hover:text-primary/80">
            <Search className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Browse</span>
          </button>
          <button type="button" onClick={() => handleNav('book-viewing')} className="flex flex-col items-center justify-center w-full py-2 text-muted-foreground hover:text-foreground">
            <Calendar className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium uppercase tracking-wider">Book</span>
          </button>
        </div>
      </div>
    </div>
  );
}
