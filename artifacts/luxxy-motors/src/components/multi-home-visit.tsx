import { useState } from 'react';
import type { DealerConfig } from '@/config/dealer';
import { MapPin, ArrowUpRight } from 'lucide-react';
import { dealershipLocation } from '@/lib/dealership-location';
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
  return <section id="find-us" className="mh-section mh-find-us" aria-labelledby="mh-find-heading">
    <h2 id="mh-find-heading" tabIndex={-1}>{websiteText(settings, 'visitHeading')}</h2>
    {!location.isSample && location.lines.length ? <address>{location.lines.join(', ')}</address> : <p>Contact us to confirm our showroom address before travelling.</p>}
    {query && <div className="mh-map-panel">
      {loadedFor === query ? <iframe key={query} title="Dealership location" src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /> : <div className="mh-map-placeholder"><MapPin size={40} aria-hidden="true" /><strong>{settings.identity.name}</strong><span>{settings.address?.postcode}</span><button type="button" className="mh-button mh-pill" onClick={() => setLoadedFor(query)}>Show map</button><p className="mh-small">Loads Google Maps when you choose.</p></div>}
    </div>}
    {location.directions && <a href={location.directions} target="_blank" rel="noopener noreferrer" className="mh-text-link mh-map-directions">Open map and directions<ArrowUpRight size={17} /></a>}
    {(hasTeam || instructions || parking) && <div className={`mh-visit-notes${hasTeam ? ' mh-visit-notes--team' : ''}`}>
      {hasTeam && <div className="mh-team"><ShowroomPhoto src={content!.teamImageUrl!} alt={customerDefaultCopy(content?.teamImageAlt, 'Our team', ['The dealership team'])} className="mh-team-photo" /><div><h3>{websiteText(settings, 'teamHeading')}</h3><p>{teamIntroduction}</p></div></div>}
      {(instructions || parking) && <div className="mh-arrival">{instructions && <div><h3>{websiteText(settings, 'contactBeforeHeading')}</h3><p>{instructions}</p></div>}{parking && parking !== instructions && <div><h3>{websiteText(settings, 'contactParkingHeading')}</h3><p>{parking}</p></div>}</div>}
    </div>}
  </section>;
}
