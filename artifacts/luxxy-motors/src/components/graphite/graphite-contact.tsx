import { useState } from 'react';
import { Link } from 'wouter';
import { Check, Copy, Mail, MapPin, MessageCircle } from '@/components/icons';
import { EnquiryForm } from '@/components/enquiry-form';
import { GraphiteIcon } from './graphite-icon';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { dealershipLocation } from '@/lib/dealership-location';
import { appointmentVisitNote, customerOpeningHours } from '@/lib/dealership-customer-copy';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPhoneDisplay } from '@/lib/utils';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { customerDefaultCopy, websiteText } from '@/lib/website-content';
import './graphite-workflows.css';

export function GraphiteContact() {
  const { settings, isLoading, isError, publicEnquiriesEnabled } = useDealerSettings();
  const [copyStatus, setCopyStatus] = useState('');
  const address = dealershipLocation(settings.address);
  const hours = customerOpeningHours(settings.hours);
  const phoneHref = getPhoneHref(settings);
  const whatsApp = getWhatsAppHref(`Hello ${settings.identity.name}, I’d like to ask about a car or arrange a visit.`, settings);
  const valid = !isLoading && !isError;
  async function copy() { try { await navigator.clipboard.writeText(address.lines.join(', ')); setCopyStatus('Address copied'); } catch { setCopyStatus('Select and copy the address shown here.'); } }
  return <div className="gr-contact gr-container">
    <section className="gr-contact__details" aria-labelledby="gr-contact-title">
      <h1 id="gr-contact-title">{customerDefaultCopy(websiteText(settings, 'contactTitle'), 'Talk to the showroom.', ['Contact us'])}</h1>
      <p className="gr-contact__intro">{customerDefaultCopy(websiteText(settings, 'contactIntroduction'), 'Ask about a car, arrange a visit or get help with a part exchange.', ['Call, email or message us about a car.'])}</p>
      {phoneHref && <a href={phoneHref} className="gr-contact__phone" data-testid="contact-phone"><GraphiteIcon name="phone" />{formatPhoneDisplay(settings.contact.phone!)}</a>}
      {isLoading && <p role="status" aria-busy="true">Loading contact and visiting details…</p>}
      {isError && <div role="alert"><p>We couldn’t load our latest visiting details. Please contact us before travelling.</p><button className="gr-button gr-button--secondary" onClick={() => window.location.reload()}>Try again</button></div>}
      <section className="gr-contact__location" data-testid="contact-location" aria-labelledby="find-us-heading">
        <h2 id="find-us-heading"><MapPin size={24} aria-hidden="true" />Find us{settings.address.city ? ` in ${settings.address.city}` : ''}</h2>
        {valid && <><address data-testid="contact-address">{address.lines.length ? address.lines.map((line, i) => <span key={i}>{line}</span>) : 'Contact us for our showroom address.'}</address>
          {isMultiChoiceWebsite() && <p>{appointmentVisitNote}</p>}
          {address.isSample && <p className="gr-contact__help">Sample address for this template. Contact us for the correct location before travelling.</p>}
          {address.directions && <div className="gr-contact__directions"><a href={address.directions} target="_blank" rel="noopener noreferrer" data-testid="contact-directions" className="gr-button gr-button--secondary">Get directions</a><button type="button" onClick={() => void copy()}>{copyStatus === 'Address copied' ? <Check size={16} /> : <Copy size={16} />}Copy address</button></div>}
          {copyStatus && <p role="status">{copyStatus}</p>}
        </>}
      </section>
      {valid && hours.length > 0 && <section className="gr-contact__hours"><h2>Opening hours</h2><dl>{hours.map((h, i) => <div key={i}><dt>{h.days}</dt><dd>{h.times}</dd></div>)}</dl></section>}
      {(settings.contact.email || whatsApp) && <details className="gr-contact__other"><summary>Other ways to contact us</summary><div>{settings.contact.email && <a href={`mailto:${settings.contact.email}`} data-testid="contact-email"><Mail size={20} aria-hidden="true" />{settings.contact.email}</a>}{whatsApp && <a href={whatsApp} target="_blank" rel="noopener noreferrer" data-testid="contact-whatsapp"><MessageCircle size={20} aria-hidden="true" />WhatsApp</a>}</div></details>}
      {valid && (settings.presentation?.visitInstructions || settings.presentation?.parkingInstructions) && <details className="gr-contact__other"><summary>Before your visit</summary><div>{settings.presentation.visitInstructions && <p>{settings.presentation.visitInstructions}</p>}{settings.presentation.parkingInstructions && <p>{settings.presentation.parkingInstructions}</p>}</div></details>}
    </section>
    <section className="gr-contact__form" aria-labelledby="gr-contact-message"><h2 id="gr-contact-message">Send us a message.</h2>{publicEnquiriesEnabled ? <EnquiryForm initialType="general" embedded presentation="contact" /> : <div className="gr-contact__unavailable"><p>Online enquiries are currently unavailable. Please call or email us.</p>{phoneHref && <a href={phoneHref} className="gr-button">Call the showroom</a>}</div>}{settings.testDriveBooking?.enabled && <Link href="/enquire?type=viewing" className="gr-contact__booking">Arrange a test drive<GraphiteIcon name="arrow-right" /></Link>}</section>
  </div>;
}
