import { useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, Calendar, ChevronDown, Clock3, MapPin, Phone } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useDealerFeatures } from '@/lib/dealer-features';
import { dealershipLocation } from '@/lib/dealership-location';
import { showroomHours } from '@/lib/showroom-hours';
import { cn, formatPhoneDisplay } from '@/lib/utils';
import './showroom-visit-panel.css';

const publishedInstructions = (value?: string) => {
  const text = value?.trim() ?? '';
  return /^(sample|example|placeholder)\b|replace this|tell customers/i.test(text) ? '' : text;
};

/** Practical visit details, using the dealer's published settings and UK time. */
export function ShowroomVisitPanel({
  className,
  heading = 'Plan your visit',
  bookingHref = '/enquire?type=viewing',
  showBooking = true,
}: {
  className?: string;
  heading?: string | null;
  bookingHref?: string;
  showBooking?: boolean;
}) {
  const { settings, isLoading, isError } = useDealerSettings();
  const features = useDealerFeatures();
  const headingId = useId();
  const DetailHeading = heading ? 'h4' : 'h3';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const ready = !isLoading && !isError;
  const opening = showroomHours(ready ? settings.hours ?? [] : [], now);
  const location = dealershipLocation(settings.address);
  const hasAddress = ready && !location.isSample && Boolean(settings.address?.street?.trim());
  const area = ready && !location.isSample && !hasAddress
    ? [...new Set([settings.address?.city, settings.address?.region, settings.address?.postcode].map(value => value?.trim()).filter(Boolean))].join(', ')
    : '';
  const directions = hasAddress ? location.directions : null;
  const phone = ready ? settings.contact.phone?.trim() : '';
  const canBook = ready && showBooking && features.enabled('testDriveBookings') && settings.testDriveBooking?.enabled !== false;
  const instructions = ready ? publishedInstructions(settings.presentation?.visitInstructions) : '';
  const parking = ready ? publishedInstructions(settings.presentation?.parkingInstructions) : '';

  return <div className={cn('showroom-visit-panel', className)} data-testid="showroom-visit-panel" {...(heading ? { 'aria-labelledby': headingId } : { 'aria-label': 'Showroom visit information' })}>
    {heading && <h3 id={headingId} className="showroom-visit-panel-heading">{heading}</h3>}
    <div className="showroom-visit-panel-main">
      <div className="showroom-visit-panel-location">
        <span className="showroom-visit-panel-icon"><MapPin size={25} /></span>
        <div>
          {ready && settings.identity.name && <DetailHeading>{settings.identity.name}</DetailHeading>}
          {hasAddress ? <address>{location.lines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</address>
            : <div>{area && <p className="showroom-visit-panel-note">Showroom area: {area}</p>}<p className="showroom-visit-panel-note">{isLoading ? 'Loading showroom address…' : 'Contact us to confirm the showroom address before travelling.'}</p></div>}
          {directions && <a className="showroom-visit-panel-directions" href={directions} target="_blank" rel="noopener noreferrer">Get directions<ArrowUpRight size={15} /></a>}
        </div>
      </div>
      <div className="showroom-visit-panel-hours" data-status={ready ? opening.state : 'unknown'}>
        <div className="showroom-visit-panel-today" role="status" aria-live="polite">
          <span className="showroom-visit-panel-status"><Clock3 size={17} />{isLoading ? 'Checking opening hours…' : isError ? 'Hours unavailable' : opening.statusLabel}</span>
          {ready && opening.todayText && <strong>{opening.todayText}</strong>}
          {ready && opening.state === 'closed' && opening.next && <p>Opens {opening.next}</p>}
          {ready && opening.state === 'unknown' && <p>Today’s hours aren’t confirmed. Please check before travelling.</p>}
          {ready && opening.state === 'closed' && !opening.next && <p>Contact us to arrange your next visit.</p>}
          {isError && <p>Please confirm our hours before travelling.</p>}
        </div>
        {ready && Boolean(settings.hours?.length) && <details className="showroom-visit-panel-week">
          <summary>Opening hours<ChevronDown size={16} /></summary>
          <dl>{settings.hours!.map((hour, index) => <div key={`${hour.days}-${index}`}><dt>{hour.days}</dt><dd>{hour.times}</dd></div>)}</dl>
        </details>}
      </div>
    </div>
    {(instructions || parking) && <div className="showroom-visit-panel-arrival">
      <DetailHeading>When you arrive</DetailHeading>
      {instructions && <p>{instructions}</p>}
      {parking && parking !== instructions && <p>{parking}</p>}
    </div>}
    {(canBook || phone) && <div className="showroom-visit-panel-actions">
      {canBook && <Button asChild><Link href={bookingHref}><Calendar size={17} />{settings.bookViewing.ctaLabel}</Link></Button>}
      {phone && <Button asChild variant="outline"><a href={`tel:${phone.replace(/[^0-9+]/g, '')}`}><Phone size={17} /><span>Call Us <span className="showroom-visit-panel-number">{formatPhoneDisplay(phone)}</span></span></a></Button>}
    </div>}
  </div>;
}
