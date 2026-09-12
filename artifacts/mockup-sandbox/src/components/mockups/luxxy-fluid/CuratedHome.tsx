import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Heart,
  MapPin,
  Menu,
  Phone,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { MockLink } from './_shared/Link';
import {
  Car,
  dealerConfig,
  formatMileage,
  formatPrice,
  getThumbnailUrl,
  vehicleDisplayTitle,
  cn,
  stock,
} from './_data';
import './curated-home.css';

type Brief = {
  search: string;
  make: string;
  bodyType: string;
  maxPrice: string;
};

const initialBrief: Brief = {
  search: '',
  make: '',
  bodyType: '',
  maxPrice: '',
};

const intentRoutes = [
  { id: 'city', label: 'A tidy city runabout', detail: 'Easy to park · under £8k', bodyType: 'Hatchback', maxPrice: '8000' },
  { id: 'family', label: 'Room for the whole week', detail: 'SUVs & estates · under £15k', bodyType: '', maxPrice: '15000' },
  { id: 'upgrade', label: 'A considered upgrade', detail: 'Newer stock · under £20k', bodyType: '', maxPrice: '20000' },
];

function getCarImage(car: Car) {
  return getThumbnailUrl(car) || car.images?.map((image) => typeof image === 'string' ? image : image.url).find(Boolean) || '';
}

function ResultRow({
  car,
  saved,
  compared,
  onSave,
  onCompare,
}: {
  car: Car;
  saved: boolean;
  compared: boolean;
  onSave: () => void;
  onCompare: () => void;
}) {
  const image = getCarImage(car);
  const title = vehicleDisplayTitle(car);
  const details = [car.year, car.mileage ? formatMileage(car.mileage) : car.mileageText, car.fuel, car.transmission].filter(Boolean);

  return (
    <article className="curated-result">
      <MockLink href={`/vehicle/${car.id}`} className="curated-result-image">
        {image ? <img src={image} alt="" loading="lazy" /> : <span className="curated-image-fallback">L</span>}
        <span className="curated-image-tag">{car.imageCount || car.images?.length || 0} photos</span>
      </MockLink>
      <div className="curated-result-copy">
        <div className="curated-result-heading">
          <div>
            <span className="curated-result-kicker">{car.make || 'Luxxy Motors'}{car.bodyType ? ` / ${car.bodyType}` : ''}</span>
            <h3><MockLink href={`/vehicle/${car.id}`}>{title}</MockLink></h3>
          </div>
          <button
            type="button"
            className={cn('curated-icon-button', saved && 'is-saved')}
            onClick={onSave}
            aria-label={saved ? `Remove ${title} from saved cars` : `Save ${title}`}
          >
            <Heart size={17} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>
        <p className="curated-result-variant">{car.variant || car.trim || 'Carefully inspected and prepared for its next owner.'}</p>
        <div className="curated-result-meta">
          {details.map((detail, index) => <span key={`${String(detail)}-${index}`}>{String(detail)}</span>)}
        </div>
        <div className="curated-result-footer">
          <strong>{car.price ? formatPrice(car.price, car.currency) : 'POA'}</strong>
          <div className="curated-result-actions">
            <button type="button" onClick={onCompare} className={cn('curated-compare', compared && 'is-compared')}>
              {compared && <Check size={14} />} {compared ? 'In compare' : 'Compare'}
            </button>
            <MockLink href={`/vehicle/${car.id}`} className="curated-details-link">
              See car <ArrowUpRight size={15} />
            </MockLink>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function CuratedHome() {
  const [brief, setBrief] = useState<Brief>(initialBrief);
  const [intent, setIntent] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [comparedIds, setComparedIds] = useState<string[]>([]);
  const [sort, setSort] = useState('curated');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const makes = useMemo(
    () => Array.from(new Set(stock.cars.map((car) => car.make).filter(Boolean))).sort() as string[],
    [],
  );
  const bodyTypes = useMemo(
    () => Array.from(new Set(stock.cars.map((car) => car.bodyType).filter(Boolean))).sort() as string[],
    [],
  );

  const filteredCars = useMemo(() => {
    const query = brief.search.trim().toLowerCase();
    const maxPrice = Number(brief.maxPrice);
    const result = stock.cars.filter((car) => {
      const matchesQuery = !query || [car.title, car.make, car.model, car.variant].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesMake = !brief.make || car.make === brief.make;
      const matchesBody = !brief.bodyType || car.bodyType === brief.bodyType;
      const matchesPrice = !brief.maxPrice || (car.price !== null && car.price <= maxPrice);
      return matchesQuery && matchesMake && matchesBody && matchesPrice;
    });
    return [...result].sort((a, b) => {
      if (sort === 'price-low') return (a.price || Infinity) - (b.price || Infinity);
      if (sort === 'newest') return (b.year || 0) - (a.year || 0);
      return (b.year || 0) - (a.year || 0) || (a.price || Infinity) - (b.price || Infinity);
    });
  }, [brief, sort]);

  const activeFilterCount = [brief.make, brief.bodyType, brief.maxPrice, brief.search].filter(Boolean).length;
  const setBriefValue = (key: keyof Brief, value: string) => setBrief((current) => ({ ...current, [key]: value }));
  const clearBrief = () => {
    setBrief(initialBrief);
    setIntent(null);
    setShowAll(false);
  };
  const toggleId = (id: string, collection: string[], setCollection: (next: string[]) => void) => {
    setCollection(collection.includes(id) ? collection.filter((item) => item !== id) : [...collection, id]);
  };

  return (
    <div className="curated-home">
      <header className="curated-header">
        <div className="curated-header-inner">
          <button type="button" className="curated-wordmark" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">
            <span className="curated-mark">L</span>
            <span>{dealerConfig.identity.logoText}</span>
          </button>
          <nav className="curated-nav" aria-label="Primary navigation">
            <button type="button" onClick={() => document.getElementById('curated-stock')?.scrollIntoView({ behavior: 'smooth' })}>Find a car</button>
            <button type="button" onClick={() => document.getElementById('curated-standard')?.scrollIntoView({ behavior: 'smooth' })}>Our standard</button>
            <button type="button" onClick={() => document.getElementById('curated-visit')?.scrollIntoView({ behavior: 'smooth' })}>Visit us</button>
          </nav>
          <div className="curated-header-actions">
            <a href={`tel:${dealerConfig.contact.phone}`} className="curated-phone"><Phone size={15} /> Call the showroom</a>
            <button type="button" className="curated-saved-label" onClick={() => document.getElementById('curated-stock')?.scrollIntoView({ behavior: 'smooth' })}>
              Saved <span>{savedIds.length}</span>
            </button>
            <button type="button" className="curated-menu-button" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-expanded={mobileMenuOpen} aria-label="Toggle menu">
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <nav className="curated-mobile-nav" aria-label="Mobile navigation">
            <button type="button" onClick={() => { setMobileMenuOpen(false); document.getElementById('curated-stock')?.scrollIntoView({ behavior: 'smooth' }); }}>Find a car <ArrowUpRight size={16} /></button>
            <button type="button" onClick={() => { setMobileMenuOpen(false); document.getElementById('curated-standard')?.scrollIntoView({ behavior: 'smooth' }); }}>Our standard <ArrowUpRight size={16} /></button>
            <a href={`tel:${dealerConfig.contact.phone}`}>Call the showroom <Phone size={16} /></a>
          </nav>
        )}
      </header>

      <main>
        <section className="curated-hero" id="curated-top">
          <div className="curated-hero-copy">
            <p className="curated-eyebrow"><span /> Harrow · London <span /></p>
            <h1>Find the car<br /><em>that fits.</em></h1>
            <p className="curated-hero-intro">A smaller, better-edited collection of used cars, chosen with a sharp eye and presented without the sales patter.</p>
            <button type="button" className="curated-text-cta" onClick={() => document.getElementById('curated-stock')?.scrollIntoView({ behavior: 'smooth' })}>
              Start with the collection <ArrowUpRight size={18} />
            </button>
          </div>
          <div className="curated-hero-card">
            <div className="curated-card-topline"><span>THE SHORTCUT</span><span>01 / 03</span></div>
            <div className="curated-card-icon"><Sparkles size={21} /></div>
            <h2>Tell us how you’ll use it.</h2>
            <p>Choose the closest fit. We’ll shape the collection around you.</p>
            <div className="curated-intents">
              {intentRoutes.map((route) => (
                <button
                  type="button"
                  key={route.id}
                  className={cn('curated-intent', intent === route.id && 'is-active')}
                  onClick={() => {
                    setIntent(route.id);
                    setBrief((current) => ({ ...current, bodyType: route.bodyType, maxPrice: route.maxPrice }));
                  }}
                >
                  <span><strong>{route.label}</strong><small>{route.detail}</small></span>
                  {intent === route.id ? <Check size={16} /> : <ArrowUpRight size={16} />}
                </button>
              ))}
            </div>
            <button type="button" className="curated-browse-all" onClick={() => { clearBrief(); document.getElementById('curated-stock')?.scrollIntoView({ behavior: 'smooth' }); }}>
              I’ll browse the full collection
            </button>
          </div>
          <div className="curated-hero-note"><span>Scroll to explore</span><span className="curated-scroll-line" /></div>
        </section>

        <section className="curated-stock-section" id="curated-stock">
          <div className="curated-section-heading">
            <div>
              <p className="curated-eyebrow"><span /> The live collection</p>
              <h2>Good cars.<br /><em>No clutter.</em></h2>
            </div>
            <p className="curated-section-aside">Every car is photographed in-house, clearly priced, and ready for a proper conversation.</p>
          </div>

          <div className="curated-mobile-filter-row">
            <button type="button" className="curated-filter-trigger" onClick={() => setMobileFiltersOpen(true)}><SlidersHorizontal size={16} /> Shape the brief {activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
            <span>{filteredCars.length} matches</span>
          </div>

          <div className="curated-workspace">
            <aside className={cn('curated-filter-rail', mobileFiltersOpen && 'is-mobile-open')}>
              <div className="curated-rail-heading">
                <div><span className="curated-label">Refine</span><h3>Shape the brief</h3></div>
                <button type="button" className="curated-close-filter" onClick={() => setMobileFiltersOpen(false)} aria-label="Close filters"><X size={18} /></button>
              </div>
              <label className="curated-search-field">
                <span>Search</span>
                <div><Search size={16} /><input value={brief.search} onChange={(event) => setBriefValue('search', event.target.value)} placeholder="Make, model, keyword" /></div>
              </label>
              <label className="curated-select-field">
                <span>Make</span>
                <div><select value={brief.make} onChange={(event) => setBriefValue('make', event.target.value)}><option value="">All makes</option>{makes.map((make) => <option key={make} value={make}>{make}</option>)}</select><ChevronDown size={15} /></div>
              </label>
              <label className="curated-select-field">
                <span>Shape</span>
                <div><select value={brief.bodyType} onChange={(event) => setBriefValue('bodyType', event.target.value)}><option value="">Any body style</option>{bodyTypes.map((body) => <option key={body} value={body}>{body}</option>)}</select><ChevronDown size={15} /></div>
              </label>
              <label className="curated-select-field">
                <span>Budget</span>
                <div><select value={brief.maxPrice} onChange={(event) => setBriefValue('maxPrice', event.target.value)}><option value="">Any price</option><option value="8000">Up to £8,000</option><option value="12000">Up to £12,000</option><option value="15000">Up to £15,000</option><option value="20000">Up to £20,000</option></select><ChevronDown size={15} /></div>
              </label>
              {activeFilterCount > 0 && <button type="button" className="curated-clear-button" onClick={clearBrief}>Clear all <X size={14} /></button>}
              <div className="curated-rail-note"><span className="curated-note-mark">L</span><p>Can’t see the right fit? <a href={dealerConfig.contact.phone ? `tel:${dealerConfig.contact.phone}` : '#'}>Talk to someone who can.</a></p></div>
            </aside>

            <div className="curated-results">
              <div className="curated-results-toolbar">
                <div><strong>{filteredCars.length}</strong><span> cars match your brief</span></div>
                <label className="curated-sort">Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="curated">Our edit</option><option value="newest">Newest first</option><option value="price-low">Price, low to high</option></select><ChevronDown size={14} /></label>
              </div>
              {filteredCars.length > 0 ? (
                <div className="curated-result-list">
                  {filteredCars.slice(0, showAll ? filteredCars.length : 6).map((car) => (
                    <ResultRow
                      key={car.id}
                      car={car}
                      saved={savedIds.includes(car.id)}
                      compared={comparedIds.includes(car.id)}
                      onSave={() => toggleId(car.id, savedIds, setSavedIds)}
                      onCompare={() => toggleId(car.id, comparedIds, setComparedIds)}
                    />
                  ))}
                </div>
              ) : (
                <div className="curated-empty"><Search size={25} /><h3>Nothing in this edit yet.</h3><p>Try loosening a filter and we’ll show you what’s close.</p><button type="button" onClick={clearBrief}>Reset the brief</button></div>
              )}
              {filteredCars.length > 6 && !showAll && <button type="button" className="curated-load-more" onClick={() => setShowAll(true)}>View all {filteredCars.length} matches <ArrowUpRight size={16} /></button>}
            </div>
          </div>
        </section>

        <section className="curated-standard" id="curated-standard">
          <div className="curated-standard-index">02 <span>/</span> The Luxxy standard</div>
          <div className="curated-standard-main">
            <p className="curated-eyebrow"><span /> Before it reaches you</p>
            <h2>We leave the<br /><em>guesswork out.</em></h2>
            <div className="curated-standard-points">
              {dealerConfig.whyBuy.slice(0, 3).map((item, index) => (
                <div className="curated-standard-point" key={item.title}>
                  <span>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.description}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="curated-standard-quote"><p>“A used car should feel like a good decision before you’ve even driven it.”</p><span>— The Luxxy team</span></div>
        </section>

        <section className="curated-visit" id="curated-visit">
          <div><p className="curated-eyebrow"><span /> Come and see for yourself</p><h2>Take your<br /><em>time.</em></h2></div>
          <div className="curated-visit-details"><p>Our showroom is in Harrow, West London. Drop in for a look or book a proper hour with the car you’re considering.</p><div className="curated-address"><MapPin size={17} /><span>Luxxy Motors<br />Harrow, London</span></div><a href={`tel:${dealerConfig.contact.phone}`} className="curated-text-cta">Book a viewing <ArrowUpRight size={18} /></a></div>
        </section>
      </main>

      {comparedIds.length > 0 && (
        <div className="curated-compare-tray">
          <span><strong>{comparedIds.length}</strong> car{comparedIds.length === 1 ? '' : 's'} ready to compare</span>
          <div><button type="button" onClick={() => setComparedIds([])}>Clear</button><button type="button" className="curated-compare-primary" onClick={() => document.getElementById('curated-stock')?.scrollIntoView({ behavior: 'smooth' })}>Review comparison <ArrowUpRight size={15} /></button></div>
        </div>
      )}

      <footer className="curated-footer"><span>{dealerConfig.identity.logoText}</span><span>Carefully chosen cars · {dealerConfig.address.city}</span><a href={`tel:${dealerConfig.contact.phone}`}>{dealerConfig.contact.phone}</a></footer>
    </div>
  );
}