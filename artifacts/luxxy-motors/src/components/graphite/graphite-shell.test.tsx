import type { CSSProperties } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { multiCustomerPalette, multiCustomerThemeVariables, multiPortalThemeVariables } from '@/lib/multi-customer-theme';
import { useCustomerBodyTheme } from '@/components/multi-customer-theme';
import { GraphiteFooter, GraphiteHeader } from './graphite-shell';

type Settings = Parameters<typeof GraphiteFooter>[0]['settings'];
const config = (): Settings => ({ ...dealerConfig,
  identity: { name: 'Harbour Cars', logoText: 'Harbour Cars', logoAsset: '/harbour-logo.svg' },
  contact: { phone: '02079460123', email: 'sales@harbour.example' },
  address: { street: '10 Harbour Road', city: 'Brighton', postcode: 'BN1 1AA', mapsUrl: 'https://maps.example/harbour' },
  hours: [{ days: 'Monday–Saturday', times: '09:00–18:00' }, { days: 'Sunday', times: 'Closed' }],
  legal: { companyName: 'Harbour Cars Ltd', companyNumber: '12345678', privacyUrl: '/privacy' },
  social: { instagram: 'https://instagram.com/harbour.example' },
  warranty: { ...dealerConfig.warranty!, enabled: false }, delivery: { ...dealerConfig.delivery!, enabled: false }, partExchange: { ...dealerConfig.partExchange!, enabled: false },
  testDriveBooking: { enabled: false }, presentation: {},
});
const bookingHref = '/enquire?type=viewing&vehicleId=chosen-car';
beforeEach(() => { window.history.replaceState({}, '', '/stock'); document.querySelectorAll('[data-graphite-shell-test]').forEach(node => node.remove()); });
afterEach(cleanup);

it('uses the dealership’s own logo/contact in the header and supplied address, hours and legal details in the footer', () => {
  const settings = config();
  render(<><GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} /><GraphiteFooter settings={settings} enquiriesEnabled testDriveHref={bookingHref} /></>);
  expect(screen.getByRole('img', { name: 'Harbour Cars' })).toHaveAttribute('src', '/harbour-logo.svg');
  expect(screen.getByRole('link', { name: 'Harbour Cars home' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: /Call Harbour Cars on/ })).toHaveAttribute('href', 'tel:02079460123');
  const footer = screen.getByRole('contentinfo', { name: 'Harbour Cars information' });
  expect(within(footer).getByText('10 Harbour Road')).toBeInTheDocument();
  expect(within(footer).getByText('Closed')).toBeInTheDocument();
  expect(within(footer).getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', settings.address!.mapsUrl);
  expect(within(footer).getByText('Company no. 12345678')).toBeInTheDocument();
  expect(within(footer).getByText(/Harbour Cars Ltd/)).toBeInTheDocument();
  expect(screen.queryByText(/Multi Choice|Hayes|Luxxy/)).not.toBeInTheDocument();
});

it('uses the monochrome Multi Choice artwork only on the verified Multi Choice website', () => {
  const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.content = 'https://multichoicemotors.co.uk'; meta.setAttribute('data-page-meta', ''); meta.setAttribute('data-graphite-shell-test', ''); document.head.append(meta);
  const settings = { ...config(), identity: { name: 'Multi Choice Motors', logoText: 'Multi Choice Motors', logoAsset: '/old-brand.svg' } };
  render(<GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} />);
  expect(screen.getByRole('img', { name: 'Multi Choice Motors' })).toHaveAttribute('src', '/brand/graphite/brand-wordmark.svg');
});

it('has no dealership identity leak when settings contain no identity, contact or address', () => {
  const settings = { ...config(), identity: { name: '', logoText: '', logoAsset: '' }, contact: {}, address: {}, hours: [], legal: {}, social: {} };
  render(<><GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} /><GraphiteFooter settings={settings} enquiriesEnabled testDriveHref={bookingHref} /></>);
  expect(screen.getByText('Our dealership')).toBeInTheDocument();
  expect(screen.queryByText(/Harbour|Multi Choice|Luxxy|Hayes|020/)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Opening hours' })).not.toBeInTheDocument();
});

it('keeps disabled PX, booking, warranty and delivery out of desktop, mobile and footer navigation', () => {
  const settings = config();
  render(<><GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} /><GraphiteFooter settings={settings} enquiriesEnabled testDriveHref={bookingHref} /></>);
  expect(screen.queryByRole('button', { name: 'Services' })).not.toBeInTheDocument();
  for (const name of ['Part exchange', 'Warranty', 'Delivery options', settings.bookViewing.ctaLabel]) expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
  expect(within(navigation).queryByRole('link', { name: 'Part exchange' })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Other services' })).not.toBeInTheDocument();
});

it('retains the saved count and phone in the menu, then closes it when a destination is chosen', async () => {
  render(<GraphiteHeader settings={config()} savedCount={3} testDriveHref={bookingHref} />);
  expect(screen.getByRole('link', { name: 'Saved cars, 3 saved' })).toHaveAttribute('href', '/saved');
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  const menu = screen.getByRole('dialog');
  expect(within(menu).getByRole('link', { name: 'Saved cars (3)' })).toHaveAttribute('href', '/saved');
  expect(within(menu).getByRole('link', { name: '020 7946 0123' })).toHaveAttribute('href', 'tel:02079460123');
  fireEvent.click(within(menu).getByRole('link', { name: 'Saved cars (3)' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('preserves independently enabled booking while disabled public enquiries send PX and delivery to contact', () => {
  const settings = config(); settings.testDriveBooking = { enabled: true }; settings.partExchange = { ...settings.partExchange!, enabled: true }; settings.delivery = { ...settings.delivery!, enabled: true };
  render(<><GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} enquiriesEnabled={false} /><GraphiteFooter settings={settings} enquiriesEnabled={false} testDriveHref={bookingHref} /></>);
  const footer = screen.getByRole('contentinfo');
  expect(within(footer).getByRole('link', { name: settings.bookViewing.ctaLabel })).toHaveAttribute('href', bookingHref);
  expect(within(footer).getByRole('link', { name: 'Part exchange' })).toHaveAttribute('href', '/contact');
  expect(within(footer).getByRole('link', { name: 'Delivery options' })).toHaveAttribute('href', '/contact');
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('link', { name: 'Part exchange' })).toHaveAttribute('href', '/contact');
  expect(within(screen.getByRole('navigation', { name: 'Other services' })).getByRole('link', { name: settings.bookViewing.ctaLabel })).toHaveAttribute('href', bookingHref);
});

it('honours the services display gate and never publishes a sample address as a real showroom', () => {
  const settings = config(); settings.presentation = { servicesEnabled: false }; settings.warranty = { ...settings.warranty!, enabled: true }; settings.delivery = { ...settings.delivery!, enabled: true }; settings.address = { street: '12 Example Road', city: 'Sample Town' };
  render(<><GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} /><GraphiteFooter settings={settings} enquiriesEnabled testDriveHref={bookingHref} /></>);
  expect(screen.queryByRole('button', { name: 'Services' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Warranty' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Delivery options' })).not.toBeInTheDocument();
  const footer = screen.getByRole('contentinfo');
  expect(within(footer).queryByText('12 Example Road')).not.toBeInTheDocument();
  expect(within(footer).queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
});

it.each([
  { content: 'none', expected: false },
  { content: 'whitespace', expected: false },
  { content: 'disabled warranty reason', expected: false },
  { content: 'published reason', expected: true },
  { content: 'trust point', expected: true },
  { content: 'booking', expected: true },
  { content: 'warranty', expected: true },
  { content: 'hidden services', expected: false },
])('matches the homepage About section for $content in desktop, footer and mobile links', ({ content, expected }) => {
  const settings = config(); settings.whyBuy = []; settings.trustItems = [];
  if (content === 'whitespace') { settings.whyBuy = [{ title: ' ', description: ' ' }]; settings.trustItems = [' ']; }
  if (content === 'disabled warranty reason') settings.whyBuy = [{ title: 'Warranty', description: 'Published warranty details.' }];
  if (content === 'published reason') settings.whyBuy = [{ title: 'Our approach', description: 'Speak to the team before your visit.' }];
  if (content === 'trust point') settings.trustItems = ['Independent dealership'];
  if (content === 'booking') settings.testDriveBooking = { enabled: true };
  if (content === 'warranty' || content === 'hidden services') settings.warranty = { ...settings.warranty!, enabled: true };
  if (content === 'hidden services') settings.presentation = { servicesEnabled: false };
  render(<><GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} /><GraphiteFooter settings={settings} enquiriesEnabled testDriveHref={bookingHref} /></>);
  expect(screen.queryAllByRole('link', { name: 'About us' })).toHaveLength(expected ? 2 : 0);
  for (const link of screen.queryAllByRole('link', { name: 'About us' })) expect(link).toHaveAttribute('href', '/#about');
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  const menu = screen.getByRole('navigation', { name: 'Mobile navigation' });
  expect(within(menu).queryAllByRole('link', { name: 'About us' })).toHaveLength(expected ? 1 : 0);
});

it('keeps the About link for verified appointment-only content without choosing a brand by dealer name', () => {
  const settings = config(); settings.whyBuy = []; settings.trustItems = [];
  const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.content = 'https://multichoicemotors.co.uk'; meta.setAttribute('data-page-meta', ''); meta.setAttribute('data-graphite-shell-test', ''); document.head.append(meta);
  render(<GraphiteHeader settings={settings} savedCount={0} testDriveHref={bookingHref} isHomepage />);
  expect(screen.getByRole('link', { name: 'About us' })).toHaveAttribute('href', '#about');
});

describe('graphite theme isolation', () => {
  it('keeps staff and other template token sets independent of graphite selection', () => {
    const before = multiPortalThemeVariables(), showroom = multiCustomerThemeVariables('showroom-navy'), normal = multiCustomerThemeVariables();
    const graphite = multiCustomerThemeVariables('graphite');
    expect(graphite['--mh-primary']).toBe('#25282d');
    expect(graphite['--app-font-sans']).toContain('Manrope');
    expect(multiPortalThemeVariables()).toEqual(before);
    expect(before['--portal-ink']).toBe(multiCustomerPalette.primary);
    expect(before['--mh-primary']).toBe(multiCustomerPalette.primary);
    expect(multiCustomerThemeVariables('showroom-navy')).toEqual(showroom);
    expect(multiCustomerThemeVariables()).toEqual(normal);
    expect(showroom['--mh-primary']).not.toBe(graphite['--mh-primary']);
  });
  it('restores body-rendered popup tokens when graphite leaves the route', () => {
    const variables = multiCustomerThemeVariables('graphite') as CSSProperties;
    const previous = document.body.style.getPropertyValue('--dialog-ink');
    document.body.style.setProperty('--dialog-ink', '#010203');
    function Theme() { useCustomerBodyTheme(variables); return null; }
    const view = render(<Theme />);
    expect(document.body.style.getPropertyValue('--dialog-ink')).toBe('#25282d');
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    view.unmount();
    expect(document.body.style.getPropertyValue('--dialog-ink')).toBe('#010203');
    expect(document.body).not.toHaveAttribute('data-dealer-customer');
    if (previous) document.body.style.setProperty('--dialog-ink', previous); else document.body.style.removeProperty('--dialog-ink');
  });
});
