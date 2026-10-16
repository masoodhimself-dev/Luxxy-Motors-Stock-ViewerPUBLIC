import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { dealerConfig } from '@/config/dealer';
import { Layout } from './layout';

const state = vi.hoisted(() => ({ path: '/', settings: {} as typeof dealerConfig }));
vi.mock('wouter', () => ({
  useLocation: () => [state.path, vi.fn()], useRoute: () => [false, null],
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state.settings }) }));
vi.mock('@/lib/saved-cars-context', () => ({ useSavedCars: () => ({ savedCount: 0 }) }));
vi.mock('@/components/customer-footer', () => ({ CustomerFooter: () => null }));
vi.mock('@/components/customer-chat', () => ({ CustomerChat: () => null }));
vi.mock('@/components/compare-tray', () => ({ CompareTray: () => null }));

beforeEach(() => {
  state.path = '/';
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
  it.each(['/stock', '/portal'])('keeps the regular artwork on %s', path => {
    state.path = path; render(<Layout><p>Page</p></Layout>);
    expect(logo()).toHaveAttribute('src', '/header-logo.png');
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
});
