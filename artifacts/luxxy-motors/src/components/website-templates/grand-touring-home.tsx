import { useEffect, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { ArrowRight, ArrowUpRight, ChevronDown } from '@/components/icons';
import { dealershipLocation } from '@/lib/dealership-location';
import { customerDefaultCopy } from '@/lib/website-content';
import { GrandTouringStockCard } from './grand-touring-stock';
import './grand-touring-home.css';

type Faq = { question: string; answer: string; href: string; label: string; id?: string; extra?: ReactNode };

export type GrandTouringHomepageProps = {
  settings: DealerConfig;
  cars: Car[];
  featured: Car[];
  headline: string;
  location: string;
  photo?: string;
  search: ReactNode;
  makes: ReactNode;
  reasons: ReactNode;
  reviews: ReactNode;
  partExchange: ReactNode;
  bodyTypes: ReactNode;
  visit: ReactNode;
  contact: ReactNode;
  finder: ReactNode;
  faqs: Faq[];
  isLoading: boolean;
  error: string | null;
};

/** Grand Touring's composition; retail controls keep their shared production behavior. */
export function GrandTouringHomepage({ settings, featured, headline, search, makes, reasons, reviews, partExchange, bodyTypes, visit, contact, finder, faqs, isLoading, error }: GrandTouringHomepageProps) {
  const selected = featured.slice(0, 3);
  const city = !dealershipLocation(settings.address).isSample && settings.address?.city?.trim();
  const title = customerDefaultCopy(headline, city ? `Used cars in ${city}` : 'Used cars for sale', [
    'Find Your Next Car', 'Find your next car.', 'Find your next car', 'Used cars for sale',
  ]);

  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== '#delivery') return;
      const section = document.getElementById('delivery');
      if (section instanceof HTMLDetailsElement) section.open = true;
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, []);

  return <div className="gt-design gt-home" data-testid="grand-touring-homepage" data-dealership-homepage>
    <section className="gt-home-hero" aria-labelledby="gt-home-heading">
      <div className="gt-home-container">
        <div className="gt-home-intro">
          <h1 id="gt-home-heading" tabIndex={-1}>{title}</h1>
          <p className="gt-home-welcome">Find a car. Arrange a visit.<span> Take a closer look.</span></p>
          {settings.hero.announcement?.trim() && <p className="gt-home-announcement">{settings.hero.announcement.trim()}</p>}
          {settings.presentation?.showHeroDescription && settings.hero.subcopy && <p className="gt-home-description">{settings.hero.subcopy}</p>}
        </div>
        <div className="gt-home-search" aria-label="Find your car">{search}</div>
      </div>
    </section>

    {settings.presentation?.featuredEnabled !== false && <section className="gt-home-stock gt-home-container" aria-labelledby="gt-home-stock-heading">
      <div className="gt-home-section-heading">
        <h2 id="gt-home-stock-heading">{settings.presentation?.websiteCopy?.featuredHeading?.trim() || 'On the forecourt'}</h2>
        <Link href="/stock" className="gt-home-text-link"><span>View all<span className="gt-home-link-label"> cars</span></span><ArrowRight size={18} aria-hidden="true" /></Link>
      </div>
      {isLoading ? <p className="gt-home-stock-status" role="status">Loading cars…</p> : error ? <div className="gt-home-stock-status" role="status"><p>We couldn’t load the cars. Open the stock page to try again.</p><Link className="gt-home-button" href="/stock">Browse stock<ArrowRight size={18} aria-hidden="true" /></Link></div> : selected.length ? <div className="gt-home-stock-grid">{selected.map((car, index) => <GrandTouringStockCard key={car.id} car={car} priority={index === 0} source="showroom" photoControls={false} />)}</div> : <div className="gt-home-stock-status"><h3>Ask us what’s coming in</h3><p>Contact the team for our latest arrivals.</p><Link className="gt-home-text-link" href="/contact">Contact us<ArrowRight size={18} aria-hidden="true" /></Link></div>}
    </section>}

    {!error && makes && <div className="gt-home-makes gt-home-container">{makes}</div>}

    {partExchange && <section id="part-exchange" className="gt-home-px" aria-labelledby="gt-home-px-heading">
      <div className="gt-home-px-inner gt-home-container">
        <div><h2 id="gt-home-px-heading">Your next car.<br />Your current car.</h2><p>Enter your registration to start a part exchange enquiry.</p></div>
        <div className="gt-home-px-slot">{partExchange}</div>
      </div>
    </section>}

    {!error && bodyTypes && <div className="gt-home-body-types gt-home-container">{bodyTypes}</div>}

    {reasons && <section id="about" className="gt-home-about gt-home-container" aria-labelledby="gt-home-about-heading">
      <div><h2 id="gt-home-about-heading">Buying from<br />{settings.identity.name}</h2><Link href="/contact" className="gt-home-text-link">Contact the team<ArrowUpRight size={18} aria-hidden="true" /></Link></div>
      <div>{reasons}</div>
    </section>}

    {reviews && <div className="gt-home-reviews gt-home-container">{reviews}</div>}

    {faqs.length > 0 && <section className="gt-home-faq gt-home-container" aria-labelledby="gt-home-faq-heading">
      <div><h2 id="gt-home-faq-heading">Before you visit</h2><p>A few useful answers.</p></div>
      <div>{faqs.map(faq => <details key={faq.question} id={faq.id}><summary>{faq.question}<ChevronDown size={20} aria-hidden="true" /></summary><div><p>{faq.answer}</p>{faq.extra}<Link href={faq.href} className="gt-home-text-link">{faq.label}<ArrowRight size={17} aria-hidden="true" /></Link></div></details>)}</div>
    </section>}

    {finder && <div className="gt-home-finder gt-home-container">{finder}</div>}
    {visit && <div className="gt-home-visit"><div className="gt-home-container">{visit}</div></div>}
    {contact && <section id="contact" className="gt-home-contact gt-home-container" aria-labelledby="gt-home-contact-heading"><h2 id="gt-home-contact-heading">Talk to the showroom.</h2>{contact}</section>}
  </div>;
}
