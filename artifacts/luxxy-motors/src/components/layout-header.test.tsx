import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { dealerConfig } from '@/config/dealer';
import { Layout } from './layout';
import { hslColourToHex } from '@/lib/brand-colour';

const state = vi.hoisted(() => ({ path: '/', settings: {} as typeof dealerConfig, enquiriesEnabled: true, navigate: vi.fn() }));
vi.mock('wouter', () => ({
  useLocation: () => [state.path, state.navigate], useRoute: () => [false, null],
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state.settings, publicEnquiriesEnabled: state.enquiriesEnabled }) }));
vi.mock('@/lib/saved-cars-context', () => ({ useSavedCars: () => ({ savedCount: 0 }) }));
vi.mock('@/components/customer-footer', () => ({ CustomerFooter: () => null }));

beforeEach(() => {
  state.path = '/';
  state.enquiriesEnabled = true;
  state.navigate.mockReset();
  state.settings = { ...dealerConfig,
    identity: { ...dealerConfig.identity, name: 'Maxi Autos', logoText: 'Maxi Autos', logoAsset: '/header-logo.png' },
    presentation: { ...dealerConfig.presentation, footerLogoUrl: '/footer-logo.png' },
  };
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
const logo = () => screen.getByRole('img', { name: 'Maxi Autos' });

describe('header artwork follows the background', () => {

  it('uses footer artwork on the dark homepage, regular artwork on scroll, and switches back at the top', () => {
    render(<Layout><p>Showroom</p></Layout>);
    expect(logo()).toHaveAttribute('src', '/footer-logo.png');
    Object.defineProperty(window, 'scrollY', { value: 180 }); fireEvent.scroll(window);
    expect(logo()).toHaveAttribute('src', '/header-logo.png');
    Object.defineProperty(window, 'scrollY', { value: 0 }); fireEvent.scroll(window);
    expect(logo()).toHaveAttribute('src', '/footer-logo.png');
  });
  it('uses the regular artwork when the mobile menu makes the header light', () => {
    render(<Layout><p>Showroom</p></Layout>);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(logo()).toHaveAttribute('src', '/header-logo.png');
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    expect(logo()).toHaveAttribute('src', '/footer-logo.png');
  });
  it.each(['/stock'])('keeps the regular artwork on %s', path => {
    state.path = path; render(<Layout><p>Page</p></Layout>);
    expect(logo()).toHaveAttribute('src', '/header-logo.png');
  });
  it('lets the portal own its compact staff toolbar without customer header spacing or widgets', () => {
    state.path = '/portal';
    const { container } = render(<Layout><p>Staff content</p></Layout>);
    expect(container.querySelector('[data-site-header]')).toBeNull();
    expect(screen.getByRole('main')).not.toHaveClass('pt-[var(--site-header-height)]');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(document.documentElement.style.getPropertyValue('--site-header-height')).toBe('0px');
  });
  it('honours a restored scroll position immediately', () => {
    Object.defineProperty(window, 'scrollY', { value: 300 });
    render(<Layout><p>Showroom</p></Layout>);
    expect(logo()).toHaveAttribute('src', '/header-logo.png');
  });
  it('falls back safely when no footer artwork is configured', () => {
    state.settings.presentation = { ...state.settings.presentation, footerLogoUrl: '' };
    render(<Layout><p>Showroom</p></Layout>);
    expect(logo()).toHaveAttribute('src', '/header-logo.png');
  });

  it.each(['07700 900123', '+44 7700 900123', '0044 7700 900123'])('uses the configured WhatsApp recipient correctly for %s', whatsapp => {
    state.settings.contact = { ...state.settings.contact, whatsapp };
    render(<Layout><p>Showroom</p></Layout>);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/447700900123');
  });

  it('hides an invalid WhatsApp destination rather than offering a broken customer action', () => {
    state.settings.contact = { ...state.settings.contact, whatsapp: '07700 900123 ext 4' };
    render(<Layout><p>Showroom</p></Layout>);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
  });

  it.each(['190 86% 44%', '42 82% 49%', '30.000 40.659% 35.686%'])('retains the dealer-selected accent hue for %s', accentHsl => {
    state.settings.identity.brandColors = { primaryHsl: '161.538 16.883% 15.098%', accentHsl };
    const { container } = render(<Layout><p>Showroom</p></Layout>);
    const shell = container.querySelector<HTMLElement>('.luxxy-shell')!;
    const [expectedHue] = accentHsl.match(/[\d.]+/g)!.map(Number);
    const [actualHue] = shell.style.getPropertyValue('--accent').match(/[\d.]+/g)!.map(Number);
    expect(Math.abs(actualHue - expectedHue)).toBeLessThan(2);
    expect(shell.style.getPropertyValue('--customer-footer-background')).toBe(hslColourToHex('161.538 16.883% 15.098%'));
  });

  it('keeps dealer colours on body-rendered popups and restores the prior values on exit', () => {
    document.body.style.setProperty('--dealer-page', '#010203');
    state.settings.presentation = { ...state.settings.presentation, pageColour: '#e8f4f5', panelColour: '#fff4e6' };
    const { unmount } = render(<Layout><p>Showroom</p></Layout>);
    expect(document.body.style.getPropertyValue('--dealer-page')).toBe('#e8f4f5');
    expect(document.body.style.getPropertyValue('--dealer-panel')).toBe('#fff4e6');
    unmount();
    expect(document.body.style.getPropertyValue('--dealer-page')).toBe('#010203');
    expect(document.body.style.getPropertyValue('--dealer-panel')).toBe('');
    document.body.style.removeProperty('--dealer-page');
  });
});

it.each([true, false])('mobile delivery uses the retained general enquiry only when enabled (%s)', enabled => {
  state.enquiriesEnabled = enabled;
  state.settings.delivery = { ...state.settings.delivery!, enabled: true };
  render(<Layout><p>Showroom</p></Layout>);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getByRole('button', { name: /^Delivery$/ }));
  expect(state.navigate).toHaveBeenCalledWith(enabled ? '/enquire?type=general' : '/contact');
});

it('keeps the mobile header compact and the phone number available in navigation', () => {
  state.path = '/vehicle/example';
  state.settings.contact = { ...state.settings.contact, phone: '0204 6286488' };
  const view = render(<Layout><p>Vehicle</p></Layout>);
  expect(view.container.querySelector('.header-phone-row')).toBeNull();
  expect(view.container.querySelector('.vehicle-header-call')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Open navigation menu'}));
  const navigation = screen.getByRole('navigation', {name: 'Mobile navigation'});
  expect(within(navigation).getByRole('link', {name: 'Call Us'})).toHaveAttribute('href', 'tel:02046286488');
  expect(within(navigation).getByRole('link', {name: 'Call Us'})).toHaveTextContent('020 4628 6488');
});
