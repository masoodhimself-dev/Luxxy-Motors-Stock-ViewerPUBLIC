import { useEffect, useRef, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import { EnquiryForm } from '@/components/enquiry-form';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3, Copy, Mail, MapPin, MessageCircle, Phone } from '@/components/icons';
import { getEnquiryHref, getPhoneHref, getVehicleWhatsAppHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { appointmentVisitNote, customerOpeningHours } from '@/lib/dealership-customer-copy';
import { dealershipLocation } from '@/lib/dealership-location';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { useStock } from '@/lib/stock-context';
import { getUpcomingVisitDates } from '@/lib/upcoming-visit-dates';
import { formatPhoneDisplay, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { customerDefaultCopy, websiteText } from '@/lib/website-content';
import './apex-contact.css';

export function ApexContact() {
  const { settings, isLoading, isError, publicEnquiriesEnabled } = useDealerSettings();
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const search = useSearch();
  const vehicleId = new URLSearchParams(search).get('vehicleId');
  const vehicle = vehicleId ? stock?.cars.find(car => car.id === vehicleId) : undefined;
  const awaitingVehicle = Boolean(vehicleId && !vehicle && stockLoading && !stockError);
  const [copyStatus, setCopyStatus] = useState('');
  const [failedPhoto, setFailedPhoto] = useState('');
  const addressRef = useRef<HTMLElement>(null);
  const messageHeading = useRef<HTMLHeadingElement>(null);
  const location = dealershipLocation(settings.address);
  const number = settings.contact.phone;
  const phone = getPhoneHref(settings);
  const email = settings.contact.email?.trim();
  const whatsApp = vehicle
    ? getVehicleWhatsAppHref(vehicle, 'get more information about this vehicle', settings)
    : getWhatsAppHref(`Hello ${settings.identity.name}, I’d like to ask about a car or arrange a visit.`, settings);
  const ready = !isLoading && !isError;
  const canBook = ready && Boolean(settings.testDriveBooking?.enabled);
  const hours = customerOpeningHours(settings.hours);
  const upcoming = getUpcomingVisitDates(settings.hours, undefined, 1)[0];
  const today = upcoming?.relativeLabel === 'Today' ? upcoming : null;
  const appointmentOnly = isMultiChoiceWebsite();
  const photo = vehicle ? getThumbnailUrl(vehicle) : '';
  const registration = vehicle ? vehicleRegistration(vehicle) : null;
  const title = customerDefaultCopy(websiteText(settings, 'contactTitle'), `Contact ${settings.identity.name}`, ['Contact us']);
  const introduction = customerDefaultCopy(websiteText(settings, 'contactIntroduction'), '', ['Call, email or message us about a car.']);
  const city = location.isSample ? undefined : settings.address?.city?.trim();
  const visitHeading = customerDefaultCopy(websiteText(settings, 'contactDirectionsHeading'), city ? `Visit us in ${city}` : 'Visit the showroom', ['How to find us']);
  const visitInstructions = settings.presentation?.visitInstructions?.trim();
  const parkingInstructions = settings.presentation?.parkingInstructions?.trim();

  useEffect(() => {
    if (window.location.hash === '#contact-message') messageHeading.current?.focus();
  }, [vehicleId]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(location.lines.join(', '));
      setCopyStatus('Address copied.');
    } catch {
      if (addressRef.current) window.getSelection()?.selectAllChildren(addressRef.current);
      setCopyStatus('Select and copy the address shown above.');
    }
  }

  return (
    <div className="luxxy-shell apex-contact">
      <div className="apex-contact-inner">
        <header className="apex-contact-intro">
          <div className="apex-contact-intro-copy">
            <h1>{title}</h1>
            {appointmentOnly && <p className="apex-contact-appointment">
              <CalendarDays size={18} aria-hidden="true" />
              <span>{appointmentVisitNote}</span>
            </p>}
            {introduction && <p className="apex-contact-description">{introduction}</p>}
          </div>
          <div className="apex-contact-intro-links">
            <div className="apex-contact-actions">
              {canBook && <Link className="apex-contact-primary" href={getEnquiryHref('viewing', vehicle)}>
                Book a test drive <ArrowRight size={16} aria-hidden="true" />
              </Link>}
              {phone && <a className="apex-contact-call" href={phone} data-testid="contact-phone">
                <Phone size={17} aria-hidden="true" /> Call {formatPhoneDisplay(number ?? '')}
              </a>}
            </div>
            {(whatsApp || email || publicEnquiriesEnabled) && <div className="apex-contact-channels">
              {whatsApp && <a href={whatsApp} target="_blank" rel="noopener noreferrer" data-testid="contact-whatsapp">
                <MessageCircle size={17} aria-hidden="true" /> WhatsApp
              </a>}
              {email && <a href={`mailto:${email}`} title={email} data-testid="contact-email">
                <Mail size={17} aria-hidden="true" /> Email us
              </a>}
              {publicEnquiriesEnabled && <a href="#contact-message" onClick={() => messageHeading.current?.focus()}>
                Send a message
              </a>}
            </div>}
          </div>
        </header>
        {isLoading && <p role="status" className="apex-contact-feedback">Loading contact and visiting details…</p>}
        {isError && <div role="alert" className="apex-contact-feedback">
          <p>We couldn’t load our latest visiting details. Please confirm the address and opening hours before travelling.</p>
          <button type="button" className="apex-contact-text-action" onClick={() => window.location.reload()}>Try again</button>
        </div>}
        <div className="apex-contact-grid">
          <section className="apex-contact-visit" aria-labelledby="find-us-heading" data-testid="contact-location">
            <h2 id="find-us-heading"><MapPin size={23} aria-hidden="true" />{visitHeading}</h2>
            {ready ? <>
              <address ref={addressRef} data-testid="contact-address">
                {!location.isSample && location.lines.length ? <><strong>{location.lines[0]}</strong>{location.lines.length > 1 && <span>{location.lines.slice(1).join(', ')}</span>}</> : 'Contact us for the showroom address.'}
              </address>
              {location.directions && <div className="apex-contact-directions">
                <a href={location.directions} target="_blank" rel="noopener noreferrer" data-testid="contact-directions">
                  Get directions <ArrowUpRight size={16} aria-hidden="true" />
                </a>
                <button type="button" onClick={() => void copyAddress()}>
                  {copyStatus === 'Address copied.' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} Copy address
                </button>
              </div>}
              <p role="status" className="apex-contact-copy-status">{copyStatus}</p>
              <div className="apex-contact-hours">
                {today ? <p className="apex-contact-today">
                  <Clock3 size={17} aria-hidden="true" />
                  <span>Today <span className="apex-contact-date">{today.dateLabel}</span></span>
                  <strong>{today.times}</strong>
                </p> : <p className="apex-contact-note">Contact us to confirm today’s hours.</p>}
                {hours.length > 0 && <details>
                  <summary>Full opening hours <ChevronDown size={17} aria-hidden="true" /></summary>
                  <dl>{hours.map((row) => <div key={row.days}><dt>{row.days}</dt><dd>{row.times}</dd></div>)}</dl>
                </details>}
                <p className="apex-contact-note">Please check with us before visiting on a bank holiday.</p>
              </div>
              {visitInstructions && <div className="apex-contact-instructions">
                <h3>{websiteText(settings, 'contactBeforeHeading')}</h3><p>{visitInstructions}</p>
              </div>}
              {parkingInstructions && <div className="apex-contact-instructions">
                <h3>{websiteText(settings, 'contactParkingHeading')}</h3><p>{parkingInstructions}</p>
              </div>}
            </> : <p className="apex-contact-note">{isLoading ? 'Loading showroom details…' : 'Contact us to confirm our location.'}</p>}
          </section>
          <section className="apex-contact-message" aria-labelledby="contact-message">
            <h2 id="contact-message" tabIndex={-1} ref={messageHeading}>Send us a message</h2>
            {vehicle && <Link className="apex-contact-car" href={vehicleDetailPath(vehicle)}>
              {photo && failedPhoto !== photo && <img src={photo} width={100} height={70} alt="" referrerPolicy="no-referrer" onError={() => setFailedPhoto(photo)} />}
              <span><strong>{vehicleDisplayTitle(vehicle)}</strong>{registration && <span>{registration}</span>}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>}
            {isLoading || (publicEnquiriesEnabled && awaitingVehicle)
              ? <p role="status" className="apex-contact-note">{awaitingVehicle ? 'Finding the car from your advert…' : 'Loading the enquiry form…'}</p>
              : publicEnquiriesEnabled && ready ? <>
                {vehicleId && !vehicle && <p className="apex-contact-note" role="status">We couldn’t find that advert. You can still send us a general enquiry.</p>}
                <EnquiryForm initialType="general" embedded presentation="contact" vehicle={vehicle} />
              </> : <p className="apex-contact-note">Online enquiries are currently unavailable. {phone || email ? 'Please use the contact details above.' : 'Please try again later.'}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
