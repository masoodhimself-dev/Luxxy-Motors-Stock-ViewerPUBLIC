import { useState } from 'react';
import type { DealerConfig } from '@/config/dealer';
import { ArrowUpRight } from 'lucide-react';
import { dealershipLocation } from '@/lib/dealership-location';
import { appointmentVisitNote, customerOpeningHours } from '@/lib/dealership-customer-copy';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { customerDefaultCopy, websiteText } from '@/lib/website-content';
import { ShowroomPhoto } from './showroom-photo';

const published = (value?: string) => {
  const text = value?.trim() || '';
  return /^(sample|example|placeholder)\b|replace this|tell customers/i.test(text) ? '' : text;
};

/** Address-only map: no external map requests until the visitor chooses to load it. */
export function MultiHomeVisit({ settings }: { settings: DealerConfig }) {
  const location = dealershipLocation(settings.address), content = settings.presentation;
  const query = !location.isSample && settings.address?.street?.trim() && (settings.address.city?.trim() || settings.address.postcode?.trim()) ? location.lines.join(', ') : '';
  const [loadedFor, setLoadedFor] = useState('');
  const teamIntroduction = published(content?.teamIntroduction);
  const hasTeam = Boolean(content?.teamImageUrl && teamIntroduction);
  const instructions = published(content?.visitInstructions), parking = published(content?.parkingInstructions);
  const hours = customerOpeningHours(settings.hours);
  const appointmentOnly = isMultiChoiceWebsite();
  return <section id="find-us" className="mh-section mh-find-us" aria-labelledby="mh-find-heading">
    <div className="mh-visit-overview">
      <div>
        <h2 id="mh-find-heading" tabIndex={-1}>{websiteText(settings, 'visitHeading')}</h2>
        {!location.isSample && location.lines.length ? <address>{location.lines.join(', ')}</address> : <p>Contact us to confirm our showroom address before travelling.</p>}
        {appointmentOnly && <p className="mh-visit-appointment">{appointmentVisitNote}</p>}
        <div className="mh-visit-actions">
          {location.directions && <a href={location.directions} target="_blank" rel="noopener noreferrer" className="mh-text-link">Get directions<ArrowUpRight size={17} aria-hidden="true" /></a>}
          {query && <button type="button" className="mh-text-link" aria-expanded={loadedFor === query} onClick={() => setLoadedFor(loadedFor === query ? '' : query)}>{loadedFor === query ? 'Hide map' : 'Show map'}</button>}
        </div>
      </div>
      <section aria-labelledby="mh-hours-heading" className="mh-hours">
        <h3 id="mh-hours-heading">Opening hours</h3>
        {hours.length ? <dl className="mh-hours-grid">{hours.map((row, index) => <div key={index}><dt>{row.days}</dt><dd>{row.times}</dd></div>)}</dl> : <p>Contact us to confirm opening hours.</p>}
        {!appointmentOnly && <p>Please confirm your visit before travelling on bank holidays.</p>}
      </section>
    </div>
    {query && loadedFor === query && <div className="mh-map-panel"><iframe key={query} title="Dealership location" src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /></div>}
    {(hasTeam || instructions || parking) && <div className={`mh-visit-notes${hasTeam ? ' mh-visit-notes--team' : ''}`}>
      {hasTeam && <div className="mh-team"><ShowroomPhoto src={content!.teamImageUrl!} alt={customerDefaultCopy(content?.teamImageAlt, 'Our team', ['The dealership team'])} className="mh-team-photo" /><div><h3>{websiteText(settings, 'teamHeading')}</h3><p>{teamIntroduction}</p></div></div>}
      {(instructions || parking) && <div className="mh-arrival">{instructions && <div><h3>{websiteText(settings, 'contactBeforeHeading')}</h3><p>{instructions}</p></div>}{parking && parking !== instructions && <div><h3>{websiteText(settings, 'contactParkingHeading')}</h3><p>{parking}</p></div>}</div>}
    </div>}
  </section>;
}
