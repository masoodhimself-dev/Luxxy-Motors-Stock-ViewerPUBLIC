import { Link } from 'wouter';
import { ArrowUpRight, Facebook, Instagram, Mail, MapPin, Phone, Twitter } from '@/components/icons';
import type { DealerConfig } from '@/config/dealer';
import { DealerWordmark } from '@/components/brand/wordmark';
import { formatPhoneDisplay } from '@/lib/utils';
import { dealershipLocation } from '@/lib/dealership-location';
import { getUpcomingVisitDates } from '@/lib/upcoming-visit-dates';
import './customer-footer.css';

export function CustomerFooter({ settings, testDriveHref }: { settings: DealerConfig; testDriveHref: string }) {
  const address = dealershipLocation(settings.address);
  const dates = getUpcomingVisitDates(settings.hours ?? []);
  const location = [settings.address?.city, settings.address?.region].filter(Boolean).join(' · ');
  const socialLinks = [
    { label: 'Instagram', href: settings.social.instagram, Icon: Instagram },
    { label: 'Facebook', href: settings.social.facebook, Icon: Facebook },
    { label: 'X / Twitter', href: settings.social.twitter, Icon: Twitter },
  ].filter(item => item.href);

  return <footer id="contact" data-home-section className="dealership-footer mt-auto" aria-label={`${settings.identity.name} information`}>
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className={`footer-directory footer-directory-compact${dates.length ? ' footer-directory-with-hours' : ''}`}>
        <div className="footer-brand">
          <Link href="/" className={`footer-wordmark${!settings.presentation?.footerLogoUrl && settings.identity.logoAsset ? ' footer-wordmark-on-panel' : ''}`} aria-label={`${settings.identity.name} home`}><DealerWordmark {...settings.identity} logoAsset={settings.presentation?.footerLogoUrl || settings.identity.logoAsset} className={settings.presentation?.footerLogoUrl ? "h-auto w-[220px] max-w-full" : undefined} /></Link>
          {location && <p className="footer-location">{location}</p>}
          {socialLinks.length > 0 && <nav className="footer-social" aria-label="Follow us">{socialLinks.map(({ label, href, Icon }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}><Icon size={18} aria-hidden="true" /></a>)}</nav>}
        </div>

        <nav className="footer-column" aria-label="Explore our dealership">
          <h3>Our cars & services</h3>
          <Link href="/stock">Browse our cars</Link>
          <Link href="/saved">Your saved cars</Link>
          <Link href={testDriveHref}>Book a Test Drive</Link>
          {settings.partExchange?.enabled && <Link href="/enquire?type=part_exchange">Part exchange</Link>}
          {settings.warranty?.enabled && <Link href="/warranty">Warranty options</Link>}
          {settings.delivery?.enabled && <Link href="/enquire?type=delivery">Delivery options</Link>}
        </nav>

        <section className="footer-column footer-contact" aria-labelledby="footer-contact-heading">
          <h3 id="footer-contact-heading">Talk to us</h3>
          {settings.contact.phone && <a href={`tel:${settings.contact.phone.replace(/[^0-9+]/g, '')}`}><Phone size={16} aria-hidden="true" /><span>{formatPhoneDisplay(settings.contact.phone)}</span></a>}
          {settings.contact.email && <a href={`mailto:${settings.contact.email}`}><Mail size={16} aria-hidden="true" /><span>{settings.contact.email}</span></a>}
          <Link href="/enquire?type=general">Send an enquiry <ArrowUpRight size={14} aria-hidden="true" /></Link>
          {address.lines.length > 0 && <div className="footer-address"><MapPin size={16} aria-hidden="true" /><div><address>{address.lines.map((line, index) => <span key={index}>{line}</span>)}{address.isSample && <span className="footer-placeholder-note">Example address — confirm with us before travelling.</span>}</address>{address.directions && <a href={address.directions} target="_blank" rel="noopener noreferrer">Get directions <ArrowUpRight size={14} aria-hidden="true" /></a>}</div></div>}
          <Link href="/contact" className="footer-text-link">Contact & directions <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </section>

        {dates.length > 0 && <section className="footer-column footer-hours" aria-labelledby="footer-hours-heading">
          <h3 id="footer-hours-heading">Opening hours</h3>
          <dl>{dates.slice(0, 3).map(visit => <div key={visit.date}><dt><span>{visit.relativeLabel}</span><span>{['Today', 'Tomorrow'].includes(visit.relativeLabel) ? visit.dateLabel : visit.dateLabel.replace(/^\S+\s/, '')}</span></dt><dd>{visit.times}</dd></div>)}</dl>
          <Link href="/contact" className="footer-text-link">All hours & visiting details <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </section>}
      </div>

      <div className="footer-bottom">
        <div><p>© {new Date().getFullYear()} {settings.legal.companyName?.trim() || settings.identity.name?.trim() || 'Our dealership'}. All rights reserved.</p>{(settings.legal.companyNumber || settings.legal.vatNumber) && <p className="footer-company-details">{settings.legal.companyNumber && <span>Company no. {settings.legal.companyNumber}</span>}{settings.legal.vatNumber && <span>VAT no. {settings.legal.vatNumber}</span>}</p>}</div>
        {(settings.legal.privacyUrl || settings.legal.termsUrl || settings.legal.cookieUrl) && <nav aria-label="Legal information">{settings.legal.privacyUrl && <a href={settings.legal.privacyUrl}>Privacy policy</a>}{settings.legal.termsUrl && <a href={settings.legal.termsUrl}>Terms & conditions</a>}{settings.legal.cookieUrl && <a href={settings.legal.cookieUrl}>Cookies</a>}</nav>}
      </div>
    </div>
  </footer>;
}
