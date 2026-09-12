import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Facebook,
  Heart,
  Instagram,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Twitter,
  X,
} from 'lucide-react';
import { Button } from './button';
import { dealerConfig, scrollToHomeTarget } from '../_data';

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

function readableForegroundForHsl(hsl: string) {
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

const navLinkClass =
  'whitespace-nowrap font-display text-[13px] font-bold uppercase tracking-[0.1em] text-primary/80 transition-all hover:text-accent hover:translate-y-[-1px]';
const mobileNavRowClass =
  'flex items-center justify-between border-b-2 border-primary/5 py-5 text-left font-display text-lg font-bold uppercase tracking-widest text-primary transition-colors hover:text-accent';
const footerLinkClass =
  'text-[14px] font-bold uppercase tracking-widest text-primary-foreground/70 transition-colors hover:text-accent';
const footerHeadingClass = 'font-display text-xl font-bold uppercase tracking-widest text-primary-foreground mb-6';
const socialLinkClass =
  'grid h-12 w-12 place-items-center bg-primary-foreground/10 text-primary-foreground transition-all hover:bg-accent hover:text-accent-foreground hover:scale-105';

function stopNavigation(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
}

function ActionButton({
  children,
  className = mobileNavRowClass,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
}) {
  return (
    <button type="button" className={className} {...props}>
      {children}
    </button>
  );
}

export function Chrome({
  children,
  currentPath = '/',
}: {
  children: ReactNode;
  currentPath?: string;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const savedCount = 0;

  const brandStyle = {
    '--primary': dealerConfig.identity.brandColors.primaryHsl,
    '--primary-foreground': readableForegroundForHsl(dealerConfig.identity.brandColors.primaryHsl),
    '--accent': dealerConfig.identity.brandColors.accentHsl,
    '--accent-foreground': readableForegroundForHsl(dealerConfig.identity.brandColors.accentHsl),
  } as CSSProperties;

  const wordmark = dealerConfig.identity.logoText || dealerConfig.identity.name;
  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(' · ');

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
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

  return (
    <div style={brandStyle} className="luxxy-fluid min-h-[100dvh] flex flex-col bg-background font-sans text-foreground">
      <header
        ref={headerRef}
        data-site-header
        className={`fixed top-0 left-0 right-0 z-50 w-full border-b-2 transition-all duration-300 ${
          scrolled ? 'border-primary bg-background/95 backdrop-blur-md shadow-sm' : 'border-primary/10 bg-background'
        }`}
      >
        <div className="container mx-auto px-4 lg:px-8 h-[4.5rem] lg:h-[5.5rem] flex items-center justify-between gap-4">
          <ActionButton onClick={() => handleNav('top')} className="flex items-center gap-3 text-left group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-primary flex items-center justify-center text-primary-foreground font-display font-bold text-xl group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                {wordmark.charAt(0)}
              </div>
              <span className="flex flex-col text-left leading-none justify-center">
                <span className="font-display text-xl lg:text-2xl font-black tracking-tighter text-primary uppercase leading-none mt-1 group-hover:text-accent transition-colors">{wordmark}</span>
                <span className="font-display text-[10px] lg:text-[11px] font-bold tracking-widest text-primary/60 uppercase mt-1">{locationLabel}</span>
              </span>
            </div>
          </ActionButton>

          <nav className="hidden items-center gap-6 lg:flex 2xl:hidden" aria-label="Primary navigation">
            <ActionButton onClick={() => handleNav('stock')} className={navLinkClass}>Stock</ActionButton>
            <ActionButton className={navLinkClass}>Find Car</ActionButton>
            <ActionButton aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'} className={`relative flex items-center gap-2 ${navLinkClass}`}>
              <Heart className={`h-5 w-5 ${savedCount > 0 ? 'text-accent fill-current' : ''}`} />
              {savedCount > 0 && <span className="absolute -top-2 -right-2.5 bg-accent text-accent-foreground text-[10px] font-black px-1.5 min-w-[20px] text-center h-5 flex items-center justify-center rounded-none shadow-[2px_2px_0px_#000]">{savedCount}</span>}
            </ActionButton>
            <Button onClick={() => handleNav('stock')} className="h-11 px-6 font-display text-[13px] font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground rounded-none shadow-[3px_3px_0px_rgba(0,0,0,0.1)] transition-all active:translate-y-[2px] active:shadow-[1px_1px_0px_rgba(0,0,0,0.1)] ml-4">
              {dealerConfig.bookViewing.ctaLabel}
            </Button>
          </nav>

          <nav className="hidden 2xl:flex items-center gap-8" aria-label="Primary navigation">
            <ActionButton onClick={() => handleNav('stock')} className={navLinkClass}>Stock</ActionButton>
            <ActionButton className={navLinkClass}>Find Car</ActionButton>
            {dealerConfig.partExchange?.enabled && <ActionButton onClick={() => handleNav('part-exchange')} className={navLinkClass}>Part Ex</ActionButton>}
            {dealerConfig.warranty?.enabled && <ActionButton onClick={() => handleNav('warranty')} className={navLinkClass}>Warranty</ActionButton>}
            {dealerConfig.delivery?.enabled && <ActionButton onClick={() => handleNav('delivery')} className={navLinkClass}>Delivery</ActionButton>}
            <ActionButton onClick={() => handleNav('visit')} className={navLinkClass}>Contact</ActionButton>
            <div className="flex items-center gap-6 ml-4 pl-8 border-l-2 border-primary/10">
              <a href={`tel:${dealerConfig.contact.phone}`} onClick={stopNavigation} className="group flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:scale-110" />
                <span className="whitespace-nowrap font-display text-[14px] font-bold tracking-widest text-primary transition-colors group-hover:text-accent">{dealerConfig.contact.phone}</span>
              </a>
              <ActionButton aria-label={savedCount > 0 ? `Saved cars, ${savedCount} saved` : 'Saved cars'} className={`group relative flex items-center gap-2 ${navLinkClass}`}>
                <Heart className={`h-5 w-5 transition-transform group-hover:scale-110 ${savedCount > 0 ? 'text-accent fill-current' : 'group-hover:text-accent'}`} />
                <span>Saved</span>
              </ActionButton>
              <Button onClick={() => handleNav('stock')} className="h-12 px-7 font-display text-[13px] font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground rounded-none shadow-[4px_4px_0px_rgba(0,0,0,0.15)] transition-all active:translate-y-[2px] active:translate-x-[2px] active:shadow-[1px_1px_0px_rgba(0,0,0,0.15)] ml-4">
                {dealerConfig.bookViewing.ctaLabel}
              </Button>
            </div>
          </nav>

          <button
            ref={menuButtonRef}
            type="button"
            className="lg:hidden flex h-11 w-11 items-center justify-center text-primary transition-colors hover:text-accent bg-secondary/50 rounded-none"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <nav ref={mobileMenuRef} aria-label="Mobile navigation" className="lg:hidden absolute top-[4.5rem] left-0 w-full border-b-2 border-primary bg-background px-4 pb-8 pt-4 flex flex-col max-h-[calc(100vh-4.5rem)] overflow-y-auto shadow-2xl">
            <ActionButton onClick={() => handleNav('top')}>Home <ArrowRight className="w-5 h-5 opacity-40" /></ActionButton>
            <ActionButton onClick={() => handleNav('stock')}>Browse Stock <ArrowRight className="w-5 h-5 text-accent" /></ActionButton>
            {dealerConfig.partExchange?.enabled && <ActionButton onClick={() => handleNav('part-exchange')}>Part Exchange <ArrowRight className="w-5 h-5 opacity-40" /></ActionButton>}
            {dealerConfig.warranty?.enabled && <ActionButton onClick={() => handleNav('warranty')}>Warranty <ArrowRight className="w-5 h-5 opacity-40" /></ActionButton>}
            {dealerConfig.delivery?.enabled && <ActionButton onClick={() => handleNav('delivery')}>Delivery <ArrowRight className="w-5 h-5 opacity-40" /></ActionButton>}
            <ActionButton onClick={() => setMobileMenuOpen(false)}>
              <span className="flex items-center gap-3">Saved Cars</span>
              <Heart className="w-5 h-5 text-accent" />
            </ActionButton>
            <ActionButton onClick={() => handleNav('about')}>Why Buy From Us <ArrowRight className="w-5 h-5 opacity-40" /></ActionButton>
            <ActionButton onClick={() => handleNav('visit')}>Contact & Location <ArrowRight className="w-5 h-5 opacity-40" /></ActionButton>
            <div className="mt-8 flex flex-col gap-4 pb-4">
              <a href={`tel:${dealerConfig.contact.phone}`} onClick={stopNavigation} className="flex items-center justify-between p-4 bg-primary text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                <span className="font-display font-bold uppercase tracking-widest text-sm flex items-center gap-3"><Phone className="h-5 w-5" /> Call us</span>
                <span className="font-display font-black tracking-wider text-base">{dealerConfig.contact.phone}</span>
              </a>
              <a href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/\D/g, '')}`} onClick={stopNavigation} className="flex items-center justify-between p-4 bg-[#25D366] text-white transition-colors hover:bg-[#128C7E]">
                <span className="font-display font-bold uppercase tracking-widest text-sm flex items-center gap-3"><MessageCircle className="h-5 w-5" /> Message</span>
                <span className="font-display font-black tracking-wider text-base">WhatsApp</span>
              </a>
            </div>
          </nav>
        )}
      </header>

      <main className={`flex-1 w-full flex flex-col ${currentPath === '/' ? '' : 'pt-[var(--site-header-height)]'}`}>
        {children}
      </main>

      <footer id="contact" data-home-section className="mt-auto bg-primary pt-16 pb-8 text-primary-foreground border-t-8 border-accent">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="mb-16 grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-5">
              <p className="font-display text-3xl font-black uppercase tracking-tighter text-primary-foreground mb-1">{wordmark}</p>
              {locationLabel && <p className="font-display text-xs font-bold uppercase tracking-widest text-primary-foreground/50 mb-6">{locationLabel}</p>}
              <p className="mb-8 max-w-sm text-base leading-relaxed text-primary-foreground/80 font-medium">
                {dealerConfig.hero.subcopy.trim().toLowerCase() === 'quality used vehicles. straightforward buying. exceptional service.'
                  ? 'Clear details, fair prices and time to look properly before you decide.'
                  : dealerConfig.hero.subcopy}
              </p>
              <div className="flex items-center gap-3">
                {dealerConfig.social.instagram && <a href={dealerConfig.social.instagram} onClick={stopNavigation} aria-label="Instagram" className={socialLinkClass}><Instagram className="w-5 h-5" /></a>}
                {dealerConfig.social.facebook && <a href={dealerConfig.social.facebook} onClick={stopNavigation} aria-label="Facebook" className={socialLinkClass}><Facebook className="w-5 h-5" /></a>}
                {dealerConfig.social.twitter && <a href={dealerConfig.social.twitter} onClick={stopNavigation} aria-label="Twitter" className={socialLinkClass}><Twitter className="w-5 h-5" /></a>}
              </div>
            </div>
            <div className="lg:col-span-2">
              <h3 className={footerHeadingClass}>Vehicles</h3>
              <nav className="flex flex-col items-start gap-4">
                <ActionButton onClick={() => handleNav('stock')} className={footerLinkClass}>All Stock</ActionButton>
                <ActionButton className={footerLinkClass}>Find My Car</ActionButton>
                <ActionButton onClick={() => handleNav('part-exchange')} className={footerLinkClass}>Part Exchange</ActionButton>
                <ActionButton onClick={() => handleNav('stock')} className={footerLinkClass}>{dealerConfig.bookViewing.ctaLabel}</ActionButton>
                <ActionButton onClick={() => handleNav('warranty')} className={footerLinkClass}>Warranty</ActionButton>
              </nav>
            </div>
            <div className="lg:col-span-2">
              <h3 className={footerHeadingClass}>Visit</h3>
              <div className="space-y-5 text-sm text-primary-foreground/80 font-medium">
                <a href={`tel:${dealerConfig.contact.phone}`} onClick={stopNavigation} className="group flex items-center gap-3 transition-colors hover:text-accent">
                  <Phone className="w-4 h-4 shrink-0 text-accent group-hover:scale-110 transition-transform" />
                  <span className="font-display font-bold tracking-widest text-primary-foreground group-hover:text-accent">{dealerConfig.contact.phone}</span>
                </a>
                <div className="flex items-start gap-3 mt-4">
                  <MapPin className="w-4 h-4 text-accent shrink-0 mt-1" />
                  <address className="not-italic space-y-1 leading-relaxed">
                    <p>{dealerConfig.address.city}</p>
                    <p>{dealerConfig.address.region}</p>
                  </address>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-6 border-t-2 border-primary-foreground/10 pt-8 mt-12 text-[12px] font-bold text-primary-foreground/40 md:flex-row">
            <p>© {new Date().getFullYear()} {dealerConfig.legal.companyName || dealerConfig.identity.name}. ALL RIGHTS RESERVED.</p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
              <span>Luxxy Motors</span>
            </div>
          </div>
        </div>
      </footer>
      <div data-home-scroll-spacer aria-hidden="true" className="bg-primary" />
    </div>
  );
}