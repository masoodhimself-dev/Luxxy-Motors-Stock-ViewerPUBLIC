import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, Phone, X } from 'lucide-react';
import { dealerConfig, scrollToHomeTarget } from './_data';

export function ModernChrome({
  children,
  currentPath = '/',
}: {
  children: ReactNode;
  currentPath?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const wordmark = dealerConfig.identity.logoText || dealerConfig.identity.name;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const setHeight = () => document.documentElement.style.setProperty('--modern-header-height', `${header.getBoundingClientRect().height}px`);
    setHeight();
    const observer = new ResizeObserver(setHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--modern-header-height');
    };
  }, []);

  const goTo = (target: string) => {
    setMenuOpen(false);
    if (currentPath === '/') scrollToHomeTarget(target);
  };

  return (
    <div className="luxxy-modern flex min-h-[100dvh] flex-col">
      <header
        ref={headerRef}
        className={`fixed inset-x-0 top-0 z-50 border-b modern-rule transition-all duration-200 ${
          scrolled ? 'bg-[hsl(var(--modern-ivory)/.88)] shadow-[0_8px_24px_rgba(20,24,32,.05)] backdrop-blur-xl' : 'bg-[hsl(var(--modern-ivory)/.96)]'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-4 sm:h-[76px] sm:px-6 lg:px-8">
          <button onClick={() => goTo('top')} className="modern-focus rounded-sm text-left">
            <span className="modern-display text-[19px] font-semibold tracking-[-.06em]">{wordmark}</span>
            <span className="ml-2 hidden border-l modern-rule pl-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[hsl(var(--modern-muted))] sm:inline">Motors</span>
          </button>

          <nav aria-label="Primary navigation" className="hidden items-center gap-8 md:flex">
            <button onClick={() => goTo('inventory')} className="modern-focus rounded-sm text-sm text-[hsl(var(--modern-muted))] hover:text-[hsl(var(--modern-ink))]">Stock</button>
            <button onClick={() => goTo('inventory')} className="modern-focus rounded-sm text-sm text-[hsl(var(--modern-muted))] hover:text-[hsl(var(--modern-ink))]">Find a car</button>
            <button onClick={() => goTo('visit')} className="modern-focus rounded-sm text-sm text-[hsl(var(--modern-muted))] hover:text-[hsl(var(--modern-ink))]">Visit</button>
          </nav>

          <div className="hidden items-center gap-5 md:flex">
            <a href={`tel:${dealerConfig.contact.phone}`} className="modern-focus rounded-sm text-sm text-[hsl(var(--modern-muted))] hover:text-[hsl(var(--modern-blue))]">{dealerConfig.contact.phone}</a>
            <button onClick={() => goTo('inventory')} className="modern-focus min-h-11 rounded-full bg-[hsl(var(--modern-ink))] px-5 text-sm font-semibold text-[hsl(var(--modern-ivory))] hover:bg-[hsl(var(--modern-blue))]">Browse stock</button>
          </div>

          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="modern-focus grid h-11 w-11 place-items-center rounded-full hover:bg-[hsl(var(--modern-panel))] md:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <nav aria-label="Mobile navigation" className="border-t modern-rule bg-[hsl(var(--modern-ivory))] px-4 py-3 md:hidden">
            <button onClick={() => goTo('inventory')} className="modern-focus flex min-h-11 w-full items-center border-b modern-rule py-3 text-left text-base">Stock</button>
            <button onClick={() => goTo('inventory')} className="modern-focus flex min-h-11 w-full items-center border-b modern-rule py-3 text-left text-base">Find a car</button>
            <button onClick={() => goTo('visit')} className="modern-focus flex min-h-11 w-full items-center py-3 text-left text-base">Visit us</button>
            <a href={`tel:${dealerConfig.contact.phone}`} className="mt-2 flex min-h-11 items-center gap-2 text-sm text-[hsl(var(--modern-blue))]"><Phone className="h-4 w-4" /> {dealerConfig.contact.phone}</a>
          </nav>
        )}
      </header>
      <main className={`flex-1 ${currentPath === '/' ? '' : 'pt-[var(--modern-header-height)]'}`}>{children}</main>
      <footer id="visit" className="border-t modern-rule bg-[hsl(var(--modern-panel))]">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-10 text-sm sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
          <div>
            <p className="modern-display text-lg font-semibold">{wordmark}</p>
            <p className="mt-2 text-[hsl(var(--modern-muted))]">{dealerConfig.address.city}, {dealerConfig.address.region}</p>
          </div>
          <a href={`tel:${dealerConfig.contact.phone}`} className="modern-focus w-fit rounded-sm text-[hsl(var(--modern-blue))] hover:underline">{dealerConfig.contact.phone}</a>
        </div>
      </footer>
    </div>
  );
}