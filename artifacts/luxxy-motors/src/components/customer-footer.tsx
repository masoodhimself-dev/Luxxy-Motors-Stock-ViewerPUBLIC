import { Link } from 'wouter';
import { ArrowUpRight, Facebook, Instagram, Mail, MapPin, Phone, Twitter } from 'lucide-react';
import type { DealerConfig } from '@/config/dealer';
import { DealerWordmark } from '@/components/brand/wordmark';
import { formatPhoneDisplay } from '@/lib/utils';
import { dealershipLocation } from '@/lib/dealership-location';
import { getUpcomingVisitDates } from '@/lib/upcoming-visit-dates';

export function CustomerFooter({ settings, testDriveHref }: { settings: DealerConfig; testDriveHref: string }) {
  const address = dealershipLocation(settings.address);
  const dates = getUpcomingVisitDates(settings.hours ?? []);
  const location = [settings.address?.city, settings.address?.region].filter(Boolean).join(' · ');
  const socialLinks = [
    { label: 'Instagram', href: settings.social.instagram, Icon: Instagram },
    { label: 'Facebook', href: settings.social.facebook, Icon: Facebook },
    { label: 'X / Twitter', href: settings.social.twitter, Icon: Twitter },
  ].filter(item => item.href);
  const introduction = settings.hero.subcopy.trim();

  return <footer id="contact" data-home-section className="dealership-footer mt-auto" aria-label={`${settings.identity.name} information`}>
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="footer-invitation">
        <div><p className="footer-eyebrow">Your next car starts here</p><h2>Let’s find the right car for you.</h2><p>Ask us a question or arrange a test drive. We’ll help with your next step.</p></div>
        <Link href="/contact" className="footer-contact-button">Get in touch <ArrowUpRight size={19} aria-hidden="true" /></Link>
      </div>

      <div className="footer-directory">
        <div className="footer-brand">
          <Link href="/" className={`footer-wordmark${!settings.presentation?.footerLogoUrl && settings.identity.logoAsset ? ' footer-wordmark-on-panel' : ''}`} aria-label={`${settings.identity.name} home`}><DealerWordmark {...settings.identity} logoAsset={settings.presentation?.footerLogoUrl || settings.identity.logoAsset} /></Link>
          {location && <p className="footer-location">{location}</p>}
          <p className="footer-introduction">{!introduction || introduction.toLowerCase() === 'quality used vehicles. straightforward buying. exceptional service.' ? 'Browse our cars, get to know the details and take your time choosing.' : introduction}</p>
          {socialLinks.length > 0 && <nav className="footer-social" aria-label="Follow us">{socialLinks.map(({ label, href, Icon }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}><Icon size={18} aria-hidden="true" /></a>)}</nav>}
        </div>

        <nav className="footer-column" aria-label="Explore our dealership">
          <h3>Our cars & services</h3>
          <Link href="/stock">Browse our cars</Link>
          <Link href="/saved">Your saved cars</Link>
          <Link href={testDriveHref}>Book a test drive</Link>
          {settings.partExchange?.enabled && <Link href="/enquire?type=part_exchange">Part exchange</Link>}
          {settings.warranty?.enabled && <Link href="/warranty">Warranty options</Link>}
          {settings.delivery?.enabled && <Link href="/enquire?type=delivery">Delivery options</Link>}
        </nav>

        <section className="footer-column footer-contact" aria-labelledby="footer-contact-heading">
          <h3 id="footer-contact-heading">Talk to us</h3>
          {settings.contact.phone ? <a href={`tel:${settings.contact.phone.replace(/[^0-9+]/g, '')}`}><Phone size={16} aria-hidden="true" /><span>{formatPhoneDisplay(settings.contact.phone)}</span></a> : <p className="footer-placeholder"><Phone size={16} aria-hidden="true" /><span>Phone number to be added</span></p>}
          {settings.contact.email ? <a href={`mailto:${settings.contact.email}`}><Mail size={16} aria-hidden="true" /><span>{settings.contact.email}</span></a> : <p className="footer-placeholder"><Mail size={16} aria-hidden="true" /><span>Email address to be added</span></p>}
          <div className="footer-address"><MapPin size={16} aria-hidden="true" /><div>{address.lines.length > 0 ? <address>{address.lines.map((line, index) => <span key={index}>{line}</span>)}{address.isSample && <span className="footer-placeholder-note">Example address — confirm with us before travelling.</span>}</address> : <p className="footer-placeholder">Showroom address to be added</p>}{address.directions && <a href={address.directions} target="_blank" rel="noopener noreferrer">Get directions <ArrowUpRight size={14} aria-hidden="true" /></a>}</div></div>
          <Link href="/contact" className="footer-text-link">Contact & directions <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </section>

        <section className="footer-column footer-hours" aria-labelledby="footer-hours-heading">
          <h3 id="footer-hours-heading">Come and see us</h3>
          {dates.length > 0 ? <dl>{dates.map(visit => <div key={visit.date}><dt><span>{visit.relativeLabel}</span><span>{['Today', 'Tomorrow'].includes(visit.relativeLabel) ? visit.dateLabel : visit.dateLabel.replace(/^\S+\s/, '')}</span></dt><dd>{visit.times}</dd></div>)}</dl> : <div className="footer-hours-placeholder"><p className="footer-placeholder">Opening hours to be added</p><p>Contact us to arrange a suitable time.</p></div>}
          <p className="footer-visit-note">Please confirm your test drive before travelling.</p>
          <Link href="/contact" className="footer-text-link">Plan your visit <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </section>
      </div>

      <div className="footer-bottom">
        <div><p>© {new Date().getFullYear()} {settings.legal.companyName || settings.identity.name}. All rights reserved.</p>{(settings.legal.companyNumber || settings.legal.vatNumber) && <p className="footer-company-details">{settings.legal.companyNumber && <span>Company no. {settings.legal.companyNumber}</span>}{settings.legal.vatNumber && <span>VAT no. {settings.legal.vatNumber}</span>}</p>}</div>
        {(settings.legal.privacyUrl || settings.legal.termsUrl || settings.legal.cookieUrl) && <nav aria-label="Legal information">{settings.legal.privacyUrl && <a href={settings.legal.privacyUrl}>Privacy policy</a>}{settings.legal.termsUrl && <a href={settings.legal.termsUrl}>Terms & conditions</a>}{settings.legal.cookieUrl && <a href={settings.legal.cookieUrl}>Cookies</a>}</nav>}
      </div>
    </div>
  </footer>;
}
