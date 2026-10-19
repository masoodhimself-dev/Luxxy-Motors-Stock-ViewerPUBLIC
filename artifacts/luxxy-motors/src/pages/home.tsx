import { VehicleFactIcon } from "@/components/vehicle-fact-icon";
import { CompareSelectionLink } from '@/components/saved-car-controls';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import './stock-redesign.css';
import './home-redesign.css';
import { customerDefaultCopy, websiteText } from "@/lib/website-content";
import { useSavedCars } from '@/lib/saved-cars-context';
import { CustomerReviews } from '@/components/customer-reviews';
import { arrivalTime } from '@/lib/stock-presentation';
import { RollingStock } from '@/components/rolling-stock';
import { HeroStockSearch } from '@/components/hero-stock-search';
import { RecentlyViewed } from '@/components/recently-viewed';
import { DealershipVisit } from "@/components/dealership-visit";
import { ShowroomPhoto } from "@/components/showroom-photo";
import demoCarHero from "@/assets/demo-car-hero.jpg";
import { useDemoStatus } from "@/lib/demo-status";
import luxxyHeroImage from "@/assets/luxxy-hero.jpg";
import {
  readBrowseSession,
  saveBrowseSession,
  restoreBrowsePosition,
} from "@/lib/browse-session";
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { cn, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { hasExplicitClearHistory, recordedWriteOffCategory, vehicleWriteOffCategory } from '@/lib/vehicle-history';
import { vehicleBenefits } from '@/lib/vehicle-benefits';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import {
  focusHomeTarget,
  flushPendingHomeTarget,
  scrollToHomeTarget,
  hasPendingHomeTarget,
} from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, Grid2X2, List, ChevronDown, Heart, Link2, SlidersHorizontal } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { getGetRecentHandoversQueryKey, useGetRecentHandovers } from '@workspace/api-client-react';

const defaultFilters: FilterState = {
  make: '',
  model: '',
  minPrice: '',
  maxPrice: '',
  fuel: '',
  transmission: '',
  search: '',
  catS: false,
  catN: false,
  noWriteOff: false,
  ulez: false,
  lowMileage: false,
  lowAnnualTax: false,
  lowInsuranceGroup: false,
  sort: '',
};
const benefitChoices = [
  { key: 'ulez', label: 'ULEZ compliant', note: 'Cars with supplied specifications that meet ULEZ emissions standards.' },
  { key: 'lowMileage', label: 'Up to 30,000 miles', note: 'Includes cars with a recorded mileage of 30,000 miles or less.' },
  { key: 'lowAnnualTax', label: 'Road tax up to £35/year', note: 'Cars with annual road tax of £35 or less. Tax rates can change; ask us to confirm the current rate before buying.' },
  { key: 'lowInsuranceGroup', label: 'Insurance groups 1–15', note: 'Lower numbered insurance groups. Your personal insurance quote can still vary.' },
] as const;
const STOCK_VIEW_KEY = 'luxxy.stock-view.v1';

export default function Home({ browseStock = false }: { browseStock?: boolean }) {
  const demoSite = useDemoStatus();
  const [, setLocation] = useLocation();
  useEffect(() => {
    const redirectStock = () => {
      if (!browseStock && ['#stock', '#vehicle-results'].includes(window.location.hash)) setLocation('/stock');
    };
    redirectStock();
    window.addEventListener('hashchange', redirectStock);
    return () => window.removeEventListener('hashchange', redirectStock);
  }, [browseStock, setLocation]);
  const { stock, isLoading, error } = useStock();
  const publicCars = useMemo(() => (stock?.cars ?? []).filter(car => !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus).toLowerCase())), [stock?.cars]);
  const { settings: dealerConfig } = useDealerSettings();
  const recentHandoversQuery = useGetRecentHandovers({
    query: {
      queryKey: getGetRecentHandoversQueryKey(),
      enabled: dealerConfig.recentHandovers.enabled,
    },
  });
  const [showAll, setShowAll] = useState(
    () => browseStock || readBrowseSession().showAll === true,
  );
  const [stockView, setStockView] = useState<'cards' | 'compact'>(() => {
    try {
      return window.localStorage.getItem(STOCK_VIEW_KEY) === 'compact' ? 'compact' : 'cards';
    } catch {
      return 'cards';
    }
  });

  usePageMeta({ ...showroomPageMeta(dealerConfig, { count: stock ? publicCars.length : null }), ...(browseStock ? { title: 'Browse Stock | ' + dealerConfig.identity.name, url: window.location.origin + '/stock' } : {}) });

  const { savedCount } = useSavedCars();
  const [copyNotice, setCopyNotice] = useState('');
  const [stockOptionsOpen, setStockOptionsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(() => readBrowseSession().visibleCount || 12);
  const [filters, setFilters] = useState<FilterState>(() => {
    if (browseStock && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const next = { ...defaultFilters };
      for (const key of Object.keys(next) as (keyof FilterState)[]) {
        const value = params.get(key);
        if (value !== null) Object.assign(next, { [key]: typeof next[key] === 'boolean' ? value === 'true' : value });
      }
      return next;
    }
    const saved = readBrowseSession().filters;
    return saved &&
      Object.keys(defaultFilters).every(
        (key) =>
          (saved[key as keyof FilterState] === undefined && benefitChoices.some(choice => choice.key === key)) ||
          typeof saved[key as keyof FilterState] === typeof defaultFilters[key as keyof FilterState],
      )
      ? { ...defaultFilters, ...saved }
      : defaultFilters;
  });

  const benefitsByCar = useMemo(() => new Map(publicCars.map(car => [car.id, vehicleBenefits(car)])), [publicCars]);

  useEffect(() => {
    if (!browseStock) return;
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, String(value)); });
    const query = params.toString();
    const url = window.location.pathname + (query ? '?' + query : '');
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', url);
  }, [filters, browseStock]);

  useEffect(() => {
    if (!browseStock) return;
    const restoreQuery = () => {
      const params = new URLSearchParams(window.location.search);
      const next = {...defaultFilters};
      for (const key of Object.keys(next) as (keyof FilterState)[]) {
        const value = params.get(key);
        if (value !== null) Object.assign(next, {[key]: typeof next[key] === 'boolean' ? value === 'true' : value});
      }
      setFilters(next);
    };
    window.addEventListener('popstate', restoreQuery);
    return () => window.removeEventListener('popstate', restoreQuery);
  }, [browseStock]);

  const filteredCars = useMemo(() => {
    let result = [...publicCars];

    const q = filters.search.trim().toLowerCase();
    if (q) {
      const compactRegistration = q.replace(/[\s-]/g, '');
      result = result.filter(
        (c) =>
          (c.title && c.title.toLowerCase().includes(q)) ||
          (c.make && c.make.toLowerCase().includes(q)) ||
          (c.model && c.model.toLowerCase().includes(q)) ||
          [c.plate, c.vrm, c.registration].some((registration) =>
            compactRegistration && registration?.toLowerCase().replace(/[\s-]/g, '').includes(compactRegistration),
          ),
      );
    }

    if (filters.make) result = result.filter((c) => c.make === filters.make);
    if (filters.model) result = result.filter((c) => c.model === filters.model);
    if (filters.fuel) result = result.filter((c) => c.fuel === filters.fuel);
    if (filters.transmission)
      result = result.filter((c) => c.transmission === filters.transmission);

    for (const { key } of benefitChoices) {
      if (filters[key]) result = result.filter(car => Boolean(benefitsByCar.get(car.id)?.[key]));
    }

    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) result = result.filter((c) => c.price && c.price >= min);
    }
    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) result = result.filter((c) => c.price && c.price <= max);
    }

    if (filters.noWriteOff || filters.catS || filters.catN) {
      result = result.filter((c) => {
        const history = vehicleWriteOffCategory(c);
        const cat = recordedWriteOffCategory(history);
        const isS = cat === 'S';
        const isN = cat === 'N';
        const isClear = hasExplicitClearHistory(history);

        if (filters.noWriteOff && isClear) return true;
        if (filters.catS && isS) return true;
        if (filters.catN && isN) return true;

        return false;
      });
    }

    if (filters.sort) {
      result.sort((a, b) => {
        const field = filters.sort.startsWith('price') ? 'price' : filters.sort === 'year-desc' ? 'year' : 'mileage';
        const first = filters.sort === 'arrival-desc' ? arrivalTime(a) : a[field];
        const second = filters.sort === 'arrival-desc' ? arrivalTime(b) : b[field];
        // Unknown values belong after known values in either direction.
        if (first == null || !Number.isFinite(first)) return second == null || !Number.isFinite(second) ? 0 : 1;
        if (second == null || !Number.isFinite(second)) return -1;
        switch (filters.sort) {
          case 'price-asc':
          case 'mileage-asc':
            return first - second;
          case 'year-desc':
          case 'arrival-desc':
          case 'price-desc':
          case 'mileage-desc':
            return second - first;
          default:
            return 0;
        }
      });
    }

    // Explicit sorts stay truthful; only the default stock order groups reserved cars last.
    return filters.sort ? result : result.sort((a,b) => Number(a.inventoryStatus === "reserved") - Number(b.inventoryStatus === "reserved"));
  }, [publicCars, filters, benefitsByCar]);

  // A benefit refines the current search, so its count must describe that subset.
  // Homepage shortcuts still introduce the complete stock collection.
  const benefitCountCars = browseStock ? filteredCars : publicCars;
  const benefitCounts = useMemo(() => Object.fromEntries(benefitChoices.map(({ key }) => [key, benefitCountCars.filter(car => Boolean(benefitsByCar.get(car.id)?.[key])).length])) as Record<typeof benefitChoices[number]['key'], number>, [benefitCountCars, benefitsByCar]);

  const changeFilters = (next: FilterState) => {
    setFilters(next);
    setShowAll(false);
    setVisibleCount(12);
  };
  useEffect(() => {
    saveBrowseSession({ filters, showAll, visibleCount });
  }, [filters, showAll, visibleCount]);

  useEffect(() => {
    if (!isLoading) {
      requestAnimationFrame(() => {
        if (hasPendingHomeTarget()) {
          restoreBrowsePosition(true);
          flushPendingHomeTarget();
        } else if (browseStock) restoreBrowsePosition();
      });
    }
  }, [isLoading, browseStock]);

  const displayedCars = filteredCars.slice(0, visibleCount);
  const hasFilters = Object.entries(filters).some(([key,value])=>key !== "sort" && Boolean(value));
  const recentHandovers = recentHandoversQuery.data?.handovers ?? [];
  const stockCount = publicCars.length;

  useEffect(() => {
    try {
      window.localStorage.setItem(STOCK_VIEW_KEY, stockView);
    } catch {
      // Keep the selected view usable when storage is unavailable or full.
    }
  }, [stockView]);

  const revealResults = (source: 'quick_filter' | 'filter_panel' | 'view_all') => {
    trackEvent('stock_results_opened', { source, result_count: filteredCars.length });
    setShowAll(true);
    if (!browseStock) {
      saveBrowseSession({ filters, showAll: true, scrollY: 0 });
      setLocation('/stock');
      return;
    }
    requestAnimationFrame(() => {
      if (scrollToHomeTarget('vehicle-results')) {
        focusHomeTarget('vehicle-results-heading');
      }
    });
  };

  const applyQuickFilter = (nextFilters: Partial<FilterState>, openResults = true) => {
    const preset = nextFilters.transmission
      ? 'automatic'
      : nextFilters.maxPrice
        ? `under_${nextFilters.maxPrice}`
        : benefitChoices.find(({ key }) => nextFilters[key])?.key || 'low_mileage';
    trackEvent('showroom_filter_applied', {
      source: 'quick_filter',
      preset,
      filter_count: 1,
    });
    setFilters(current => ({ ...current, ...nextFilters, ...(nextFilters.maxPrice && current.minPrice && +current.minPrice > +nextFilters.maxPrice ? { minPrice: '' } : {}) }));
    setVisibleCount(12);
    if (openResults) revealResults('quick_filter');
  };

  const toggleBenefitFilter = (key: typeof benefitChoices[number]['key'], openResults = true) => {
    setFilters(current => ({ ...current, [key]: !current[key] }));
    setVisibleCount(12);
    trackEvent('showroom_filter_applied', { source: 'quick_filter', preset: key, filter_count: 1 });
    if (openResults) revealResults('quick_filter');
  };

  // The hero is a dealership introduction; featured stock only orders the stock list.
  const heroFallbackCar = publicCars.find((car) => getThumbnailUrl(car));

  const configuredHeroImage = dealerConfig.presentation?.heroImageUrl;
  // Custom homepage photography is independent of featured stock selections.
  const usesLuxxyBrandImage =
    !configuredHeroImage &&
    /^luxxy\s+motors$/i.test(dealerConfig.identity.name.trim());
  const heroImage = configuredHeroImage || (demoSite ? demoCarHero : usesLuxxyBrandImage ? luxxyHeroImage : undefined);
  const heroAlt = configuredHeroImage
    ? dealerConfig.presentation?.heroImageAlt || `${dealerConfig.identity.name} showroom`
    : demoSite
      ? "Illustrative stock photograph of a white BMW coupe"
      : usesLuxxyBrandImage
      ? "Illustrative Luxxy brand image: a dark blue Mercedes-Benz overlooking a lake"
      : vehicleDisplayTitle(heroFallbackCar);

  const heroPhotoSource = heroImage || getThumbnailUrl(heroFallbackCar);

  const dealershipPoints = dealerConfig.whyBuy?.length ? (
    <ul className="divide-y divide-border border-y border-border">
      {(dealerConfig.whyBuy || []).map((item) => (
        <li key={item.title} className="grid gap-1.5 py-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] sm:gap-6">
          <h3 className="text-sm font-semibold leading-relaxed">{item.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        </li>
      ))}
    </ul>
  ) : dealerConfig.trustItems?.length ? <ul className="divide-y divide-border">{dealerConfig.trustItems.map(item => <li key={item} className="py-3 text-sm">{item}</li>)}</ul> : null;

  if (isLoading && browseStock)
    return (
      <div className="luxxy-shell stock-refined stock-redesign min-h-screen" aria-label="Loading stock" aria-busy="true">
        <span className="sr-only" role="status">Loading used cars</span>
        <div className="container stock-loading mx-auto px-4 sm:px-6 lg:px-8" aria-hidden="true">
          <div className="stock-loading-title stock-skeleton animate-pulse" />
          <div className="stock-loading-line stock-skeleton animate-pulse" />
          <div className="stock-loading-search" />
          <div className="stock-card-results stock-results-grid grid">
            {[1, 2, 3, 4, 5, 6].map(n => <div key={n} className="stock-loading-card"><div className="stock-loading-photo stock-skeleton animate-pulse" /><div className="stock-loading-details"><div className="stock-loading-line stock-skeleton animate-pulse" /><div className="stock-loading-line stock-skeleton animate-pulse" /><div className="stock-loading-line stock-skeleton animate-pulse" /></div></div>)}
          </div>
        </div>
      </div>
    );

  const stockViewControls = (
    <div className="flex justify-end gap-1" aria-label="Vehicle display">
      {(['cards', 'compact'] as const).map((view) => {
        const Icon = view === 'cards' ? Grid2X2 : List;
        return (
          <button
            key={view}
            type="button"
            aria-label={view === 'cards' ? 'Grid' : 'List'}
            aria-pressed={stockView === view}
            data-testid={`button-stock-view-${view}`}
            onClick={() => {
              setStockView(view);
              trackEvent('stock_view_changed', { view });
            }}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-md border',
              stockView === view
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-secondary',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={browseStock ? "luxxy-shell homepage-refined stock-refined stock-redesign min-h-screen" : "luxxy-shell homepage-refined homepage-art-directed homepage-premium min-h-screen"}>
      {!browseStock && <section className="stock-search-hero" aria-labelledby="home-heading">
        {heroPhotoSource && <div className="stock-search-backdrop" data-testid="showroom-hero-photo"><ShowroomPhoto src={heroPhotoSource} position={demoSite && !configuredHeroImage ? 'bottom' : dealerConfig.presentation?.heroImagePosition} alt={heroAlt} priority fit="cover" className="h-full" /></div>}
        <div className="stock-search-shade" aria-hidden="true" />
        <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
          <div className="stock-search-panel">
            <p className="home-hero-eyebrow">{(!demoSite && dealerConfig.hero.announcement) || `Used cars${dealerConfig.address?.city ? ` in ${dealerConfig.address.city}` : ''}`}</p>
            <h1 id="home-heading" tabIndex={-1} className="home-hero-heading">{dealerConfig.hero.copy}</h1>
            {dealerConfig.presentation?.showHeroDescription && <p className="home-hero-description">{dealerConfig.hero.subcopy}</p>}
            <HeroStockSearch loading={isLoading} buttonLabel={dealerConfig.hero.primaryCta} cars={publicCars} filters={filters} setFilters={setFilters} count={filteredCars.length} onReset={() => setFilters({ ...defaultFilters })} onSearch={() => revealResults('filter_panel')} />
          </div>
          {!isLoading && !error && filteredCars.length < 4 && <p className="home-search-help">Need help choosing? <Link className="text-link" href={'/enquire?type=general&searchRequest='+encodeURIComponent(Object.entries(filters).filter(([k,v])=>k!=='sort' && v).map(([k,v])=>`${k}: ${v}`).join(', ') || 'current stock')}>Ask us <ArrowRight size={16}/></Link></p>}
        </div>
      </section>}

      {!browseStock && !isLoading && !error && publicCars.length > 0 && <nav className="home-shopping-shortcuts container mx-auto px-4 sm:px-6 lg:px-8" aria-label="Shop by preference">
        <div className="home-shortcut-intro"><span>Find your kind of car</span><p>A few good places to start.</p></div>
        <div className="home-shortcut-grid">
          {[
            { label: 'Automatic', icon: 'Transmission', href: '/stock?transmission=Automatic', count: publicCars.filter(car => /automatic/i.test(car.transmission || '')).length },
            { label: 'Under £10k', icon: 'Price', href: '/stock?maxPrice=10000', count: publicCars.filter(car => car.price != null && car.price <= 10000).length },
            { label: 'ULEZ compliant', icon: 'Emissions', href: '/stock?ulez=true', count: publicCars.filter(car => benefitsByCar.get(car.id)?.ulez).length },
            { label: 'Up to 30k miles', icon: 'Mileage', href: '/stock?lowMileage=true', count: publicCars.filter(car => benefitsByCar.get(car.id)?.lowMileage).length },
          ].filter(choice => choice.count > 0).map(choice => <Link key={choice.href} href={choice.href} className="home-shortcut-card">
            <VehicleFactIcon label={choice.icon} value={choice.label} className="home-shortcut-icon" />
            <span className="home-shortcut-copy"><strong>{choice.label}</strong><small>{choice.count} {choice.count === 1 ? 'car' : 'cars'}</small></span>
            <ArrowRight size={17} className="home-shortcut-arrow" aria-hidden="true" />
          </Link>)}
        </div>
      </nav>}


      {!browseStock && isLoading && <section className="home-stock-loading container mx-auto px-4 sm:px-6 lg:px-8" aria-label="Loading featured cars" aria-busy="true"><p role="status">Loading cars…</p><div className="home-stock-skeletons" aria-hidden="true">{[1, 2, 3, 4].map(n => <div key={n} className="animate-pulse bg-muted" />)}</div></section>}
      {!browseStock && !isLoading && dealerConfig.presentation?.featuredEnabled !== false && <RollingStock cars={[...publicCars].sort((a, b) => Number(a.inventoryStatus === 'reserved') - Number(b.inventoryStatus === 'reserved'))} unavailable={Boolean(error)} />}

      {browseStock && <section className="stock-page-intro" aria-labelledby="vehicle-results-heading">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <nav aria-label="Breadcrumb" className="stock-breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span>Used cars</span></nav>
          <div className="stock-heading-row">
            <div className="stock-title-group">
              <h1 id="vehicle-results-heading" tabIndex={-1}>{websiteText(dealerConfig, "stockTitle")}</h1>
              {!error && stock && <p className="stock-result-count" data-testid="text-filtered-stock-count" role="status" aria-live="polite" aria-atomic="true">
                {!hasFilters
                  ? `${filteredCars.length} ${filteredCars.length === 1 ? 'car' : 'cars'} in stock`
                  : `${filteredCars.length} ${filteredCars.length === 1 ? 'car matches' : 'cars match'} your search`}
              </p>}
            </div>
            <Collapsible open={stockOptionsOpen} onOpenChange={setStockOptionsOpen} className="stock-options" data-testid="stock-secondary-actions">
              <CollapsibleTrigger className="stock-options-trigger"><SlidersHorizontal size={16} aria-hidden="true" />View options<ChevronDown size={15} aria-hidden="true" /></CollapsibleTrigger>
              <CollapsibleContent className="stock-options-panel">
                <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">Vehicle display</span>{stockViewControls}</div>
                <Link className="stock-option-action" href="/saved"><Heart size={17} aria-hidden="true" />Saved cars ({savedCount})<ArrowRight size={16} aria-hidden="true" /></Link>
                <button type="button" className="stock-option-action" onClick={async () => {try {await navigator.clipboard.writeText(window.location.href); setCopyNotice('Search link copied');} catch {setCopyNotice('Copy the address from your browser to share this search.');}}}><Link2 size={17} aria-hidden="true" />Copy search link</button>
                {copyNotice && <p className="text-sm leading-5 text-muted-foreground" role="status">{copyNotice}</p>}
              </CollapsibleContent>
            </Collapsible>
          </div>
          {customerDefaultCopy(websiteText(dealerConfig, "stockIntroduction"), '', ['Find your next used car.']) && <p className="stock-introduction">{websiteText(dealerConfig, "stockIntroduction")}</p>}
        </div>
      </section>}

      {browseStock && <section id="stock" data-home-section className="browse-stock py-8 md:py-10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Filters
            quickFilters={<>             <div className="flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                onClick={() => applyQuickFilter({ transmission: 'Automatic' }, false)}
                aria-pressed={filters.transmission === 'Automatic'}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                data-testid="button-quick-automatic"
                disabled={!publicCars.some(car => /automatic/i.test(car.transmission || ""))}
              >
                Automatic
              </button>
              <button
                type="button"
                onClick={() => applyQuickFilter({ maxPrice: '5000' }, false)}
                aria-pressed={filters.maxPrice === '5000'}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                data-testid="button-quick-under-5000"
                disabled={!publicCars.some(car => car.price != null && car.price <= 5000)}
              >
                Under £5k
              </button>
              {publicCars.some(car => car.price != null && car.price <= 15000) && <button type="button" aria-pressed={filters.maxPrice === '15000'} className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary" onClick={() => applyQuickFilter({maxPrice:'15000'}, false)}>Under £15k</button>}
              {benefitChoices.filter(({ key }) => benefitCounts[key] > 0 || filters[key]).map(({ key, label, note }) => <button
                key={key}
                type="button"
                onClick={() => toggleBenefitFilter(key, false)}
                aria-pressed={Boolean(filters[key])}
                title={note}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary"
                data-testid={key === 'lowMileage' ? 'button-quick-low-mileage' : `button-quick-${key}`}
              ><VehicleFactIcon label={label} className="mr-1.5 inline-block h-4 w-4 align-middle" />{label} <span className="tabular-nums">({benefitCounts[key]})</span></button>)}
            </div>

 </>}
            cars={publicCars}
            filters={filters}
            setFilters={changeFilters}
            vehicleCount={stockCount}
            matchCount={filteredCars.length}
            onSearch={() => {
              trackEvent('showroom_filter_applied', {
                source: 'filter_panel',
                filter_count: [
                  filters.make,
                  filters.model,
                  filters.minPrice || filters.maxPrice,
                  filters.fuel,
                  filters.transmission,
                  filters.search,
                  filters.noWriteOff,
                  filters.catS,
                  filters.catN,
                  filters.ulez,
                  filters.lowMileage,
                  filters.lowAnnualTax,
                  filters.lowInsuranceGroup,
                ].filter(Boolean).length,
                search_used: Boolean(filters.search),
                budget_used: Boolean(filters.minPrice || filters.maxPrice),
                insurance_filter_used: filters.noWriteOff || filters.catS || filters.catN,
                sort: filters.sort || 'recommended',
                result_count: filteredCars.length,
              });
              revealResults('filter_panel');
            }}
          />

          {!error && publicCars.length > 0 && <nav className="stock-shopping-shortcuts" aria-label="Shop by preference">
            {publicCars.some(car => /automatic/i.test(car.transmission || '')) && <button type="button" aria-label="Show automatic cars" aria-pressed={filters.transmission === 'Automatic'} onClick={() => applyQuickFilter({ transmission: filters.transmission === 'Automatic' ? '' : 'Automatic' })}>Automatic</button>}
            {publicCars.some(car => car.price != null && car.price <= 10000) && <button type="button" aria-label="Show cars under £10k" aria-pressed={filters.maxPrice === '10000'} onClick={() => applyQuickFilter({ maxPrice: filters.maxPrice === '10000' ? '' : '10000' })}>Under £10k</button>}
            {benefitChoices.filter(({ key }) => benefitCounts[key] > 0).slice(0, 2).map(({ key, label, note }) => <button key={key} type="button" title={note} aria-pressed={Boolean(filters[key])} onClick={() => toggleBenefitFilter(key)}>{label}</button>)}
          </nav>}

          <div id="vehicle-results" data-home-section className="mt-2 md:mt-4">
            {!error && <div className="stock-results-bar">
              <CompareSelectionLink />
            </div>}
            {error ? (
              <div className="stock-error surface p-8" role="alert">
                <h3 className="section-heading">Stock is temporarily unavailable</h3>
                <p className="mt-3 text-muted-foreground">
                  Please try again or ask us about current availability.
                </p>
                <div className="mt-5 flex flex-wrap gap-3"><Button onClick={() => window.location.reload()}>Try again</Button><Button asChild variant="outline"><Link href="/contact">Contact us</Link></Button></div>
              </div>
            ) : filteredCars.length ? (
              <>
                <div
                  className={cn(
                    'stock-results-grid grid gap-5',
                    stockView === 'compact' ? 'xl:grid-cols-2' : 'stock-card-results sm:grid-cols-2 xl:grid-cols-3',
                  )}
                >
                  {displayedCars.map((car, index) => (
                    <CarCard
                      key={car.id}
                      car={car}
                      catalogue
                      priority={index < 2}
                      layout={stockView === 'compact' ? 'compact' : 'card'}
                      stretchedLink
                    />
                  ))}
                </div>
                <div className="stock-results-end mt-6 flex flex-col items-center justify-center gap-3"><p className="text-sm text-muted-foreground">Showing {displayedCars.length} of {filteredCars.length} {filteredCars.length === 1 ? 'car' : 'cars'}</p>{visibleCount < filteredCars.length && <Button variant="outline" onClick={()=>setVisibleCount(count=>count+12)}>Show more cars</Button>}</div>
              </>
            ) : !publicCars.length ? (
              <div className="stock-empty surface px-6 py-8 text-left" data-testid="empty-stock">
                <h3 className="section-heading">No cars to show right now</h3>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">Tell us what you’re looking for, or ask us about our stock.</p>
                <Button asChild className="mt-6"><Link href="/enquire?type=general">Ask about upcoming stock <ArrowRight className="h-4 w-4" /></Link></Button>
              </div>
            ) : (
              <div className="stock-empty surface px-6 py-8 text-left">

                <h3 className="section-heading mt-4">No matches</h3>
                <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">We couldn’t find a car with these filters. Remove a filter above or widen your search below.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {(filters.minPrice || filters.maxPrice) && <Button variant="outline" onClick={()=>setFilters(current=>({...current,minPrice:'',maxPrice:''}))}>Remove price limits</Button>}
                  {filters.transmission && <Button variant="outline" onClick={() => setFilters(current => ({...current, transmission: ''}))}>Search all transmissions</Button>}
                  {filters.make && <Button variant="outline" onClick={() => setFilters(current => ({...current, make: '', model: ''}))}>Search all makes</Button>}
                  {filters.maxPrice && <Button variant="outline" onClick={() => setFilters(current => ({...current, maxPrice: String(Math.ceil(Number(current.maxPrice) * 1.25 / 500) * 500)}))}>Increase maximum price to £{(Math.ceil(Number(filters.maxPrice) * 1.25 / 500) * 500).toLocaleString('en-GB')}</Button>}
                </div>
                <Button
                  variant="outline"
                  className="mt-6"
                  onClick={() => {
                    setFilters(defaultFilters);
                    setShowAll(false);
                  }}
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>}

      {!browseStock && <>
      {dealerConfig.recentHandovers.enabled && recentHandovers.length > 0 && (
        <section
          id="recent-handovers"
          data-home-section
          data-testid="recent-handovers-section"
          className="section-space border-y border-border bg-card"
          aria-labelledby="recent-handovers-heading"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="luxxy-kicker mb-3">From our showroom</p>
            <h2 id="recent-handovers-heading" className="section-heading">
              Recently handed over
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {recentHandovers.map((handover) => {
                const v = handover.vehicle;
                const name = [v.make, v.model, v.trim].filter(Boolean).join(' ') || 'Vehicle';
                return (
                  <article
                    key={`${name}-${handover.handoverMonth}`}
                    data-testid="recent-handover"
                    className="border-t border-border pt-4"
                  >
                    <p className="text-xs text-muted-foreground">
                      {handover.handoverMonth}
                    </p>
                    <h3 className="mt-2 font-semibold">{name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {[v.year, v.bodyType, v.fuel, v.transmission].filter(Boolean).join(' · ')}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <CustomerReviews />
      {(dealershipPoints || (dealerConfig.presentation?.servicesEnabled !== false && [dealerConfig.warranty, dealerConfig.partExchange, dealerConfig.delivery].some(service => service?.enabled))) && <section id="about" className="home-dealer-information section-space container mx-auto px-4 sm:px-6 lg:px-8" aria-labelledby="home-reassurance-heading">
        <h2 id="home-reassurance-heading" tabIndex={-1} className="section-heading mb-6">Why choose us?</h2>
        {dealershipPoints}

      {dealerConfig.presentation?.servicesEnabled !== false && [dealerConfig.warranty, dealerConfig.partExchange, dealerConfig.delivery].some(service => service?.enabled) && <div className="home-services home-services-integrated">
        <div>
          <h3 className="sr-only">{websiteText(dealerConfig, "servicesHeading")}</h3>
          <div className="home-service-grid mt-8 grid gap-8">
            {(
              [
                ['warranty', dealerConfig.warranty, 'Warranty Enquiry', 'link-warranty-enquiry'],
                [
                  'part-exchange',
                  dealerConfig.partExchange,
                  'Part Exchange Enquiry',
                  'link-px-enquiry',
                ],
                ['delivery', dealerConfig.delivery, 'Delivery Enquiry', 'link-delivery-enquiry'],
              ] as const
            ).map(
              ([id, service, subject, testid]) =>
                service?.enabled && (
                  <article
                    key={id}
                    id={id}
                    data-home-section
                    className="flex flex-col border-t border-border pt-5"
                  >
                    <h3
                      id={`${id}-heading`}
                      tabIndex={-1}
                      className="font-display text-xl font-semibold leading-snug"
                    >
                      {id === 'part-exchange' ? 'Part exchange' : id === 'delivery' ? 'Delivery' : 'Warranty'}
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {id === 'delivery' ? customerDefaultCopy(service.description, 'Ask us about delivery options for your next car.', ['Customers may be able to have their vehicle delivered.']) : id === 'warranty' ? customerDefaultCopy(service.description, 'Ask us about warranty options for your chosen car.', ['Warranty options are available on eligible vehicles.']) : service.description}
                    </p>
                    <a
                      className="text-link mt-4"
                      href={id === 'warranty' ? '/warranty' : getContactHref(subject)}
                      data-testid={testid}
                    >
                      {service.ctaLabel}
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </article>
                ),
            )}
          </div>
        </div>
      </div>}
      </section>}
      {dealerConfig.presentation?.visitEnabled !== false && <DealershipVisit />}

      </>}
      {browseStock && <RecentlyViewed />}
    </div>
  );
}
