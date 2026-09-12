import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Heart, Menu, Phone, X, Search, ChevronRight } from 'lucide-react';
import { FluidButton } from './_fluid-Button';
import { dealerConfig, scrollToHomeTarget } from './_data';
import { MockLink } from './_shared/Link';

export function FluidChrome({
  children,
  currentPath = '/',
}: {
  children: ReactNode;
  currentPath?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const wordmark = dealerConfig.identity.logoText || dealerConfig.identity.name;

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeaderHeight = () => {
      document.documentElement.style.setProperty('--site-header-height', `${header.getBoundingClientRect().height}px`);
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
    if (currentPath === '/') scrollToHomeTarget(target);
  };

  const navLinkClass = "text-[14px] font-medium text-foreground/70 hover:text-foreground transition-colors";

  return (
    <div className="luxxy-fluid-proposal flex min-h-screen flex-col bg-background font-sans text-foreground selection:bg-accent/20 selection:text-foreground">
      <header
        ref={headerRef}
        className={`fixed top-0 left-0 right-0 z-50 w-full transition-all duration-300 ${
          scrolled ? 'bg-background/80 backdrop-blur-xl border-b border-border/40 shadow-[0_4px_30px_rgba(0,0,0,0.03)]' : 'bg-transparent'
        }`}
      >
        <div className="container mx-auto px-4 lg:px-8 h-[4.5rem] lg:h-[5.5rem] flex items-center justify-between">
          <button onClick={() => handleNav('top')} className="flex items-center gap-3 group focus-ring rounded-lg p-1 -ml-1">
            <div className="font-semibold text-xl tracking-tight text-foreground transition-colors group-hover:text-accent">
              {wordmark}
            </div>
          </button>

          <nav className="hidden lg:flex items-center gap-8" aria-label="Primary navigation">
            <button onClick={() => handleNav('stock')} className={navLinkClass}>Inventory</button>
            <button className={navLinkClass}>Finance</button>
            <button className={navLinkClass}>Part Exchange</button>
            <button onClick={() => handleNav('visit')} className={navLinkClass}>Contact</button>
          </nav>

          <div className="hidden lg:flex items-center gap-4">
            <a href={`tel:${dealerConfig.contact.phone}`} className="text-sm font-medium hover:text-accent transition-colors">
              {dealerConfig.contact.phone}
            </a>
            <div className="w-px h-4 bg-border mx-2" />
            <button className="p-2 text-foreground/70 hover:text-foreground transition-colors focus-ring rounded-full" aria-label="Saved cars">
              <Heart className="w-5 h-5" />
            </button>
            <FluidButton onClick={() => handleNav('stock')}>
              View Stock
            </FluidButton>
          </div>

          <button
            type="button"
            className="lg:hidden p-2 -mr-2 text-foreground/70 hover:text-foreground transition-colors focus-ring rounded-full"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-xl lg:hidden pt-[4.5rem] flex flex-col">
          <nav className="flex flex-col p-4 gap-2 overflow-y-auto">
            <button onClick={() => handleNav('stock')} className="flex items-center justify-between p-4 text-lg font-medium rounded-xl hover:bg-secondary/50">
              Inventory <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
            <button className="flex items-center justify-between p-4 text-lg font-medium rounded-xl hover:bg-secondary/50">
              Finance <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
            <button className="flex items-center justify-between p-4 text-lg font-medium rounded-xl hover:bg-secondary/50">
              Part Exchange <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
            <button onClick={() => handleNav('visit')} className="flex items-center justify-between p-4 text-lg font-medium rounded-xl hover:bg-secondary/50">
              Contact Us <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
            
            <div className="mt-8 p-4 bg-secondary/30 rounded-2xl">
              <p className="text-sm text-muted-foreground mb-4">Get in touch</p>
              <a href={`tel:${dealerConfig.contact.phone}`} className="flex items-center gap-3 text-lg font-semibold text-foreground hover:text-accent transition-colors">
                <Phone className="w-5 h-5" />
                {dealerConfig.contact.phone}
              </a>
            </div>
          </nav>
        </div>
      )}

      <main className={`flex-1 w-full flex flex-col ${currentPath === '/' ? '' : 'pt-[var(--site-header-height)]'}`}>
        {children}
      </main>

      <footer className="mt-auto border-t border-border/40 bg-background pt-16 pb-8">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-2">
              <p className="text-xl font-semibold tracking-tight text-foreground mb-4">{wordmark}</p>
              <p className="text-muted-foreground text-sm max-w-sm leading-relaxed">
                Premium automotive sales and sourcing. 
                Experience a refined approach to finding your next vehicle.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Showroom</h4>
              <nav className="flex flex-col gap-3 text-sm text-muted-foreground">
                <button onClick={() => handleNav('stock')} className="text-left hover:text-foreground transition-colors">Current Stock</button>
                <button className="text-left hover:text-foreground transition-colors">Finance Options</button>
                <button className="text-left hover:text-foreground transition-colors">Part Exchange</button>
              </nav>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Connect</h4>
              <nav className="flex flex-col gap-3 text-sm text-muted-foreground">
                <a href={`tel:${dealerConfig.contact.phone}`} className="hover:text-foreground transition-colors">{dealerConfig.contact.phone}</a>
                <button onClick={() => handleNav('visit')} className="text-left hover:text-foreground transition-colors">Location & Hours</button>
              </nav>
            </div>
          </div>
          <div className="border-t border-border/40 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} {wordmark}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
