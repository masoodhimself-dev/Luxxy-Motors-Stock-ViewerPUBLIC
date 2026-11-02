import { readFileSync } from 'node:fs';
import { createPortal } from 'react-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { Layout } from '../layout';

const state = vi.hoisted(() => ({
  path: '/portal',
  settings: {} as typeof dealerConfig,
}));
vi.mock('wouter', () => ({
  useLocation: () => [state.path, vi.fn()],
  useRoute: () => [false, null],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: state.settings, publicEnquiriesEnabled: true, isLoading: false, isError: false }),
}));
vi.mock('@/lib/saved-cars-context', () => ({ useSavedCars: () => ({ savedCount: 0 }) }));
vi.mock('@/hooks/use-stock-header', () => ({ useStockHeader: () => ({ hidden: false, reveal: vi.fn() }) }));
vi.mock('../multi-home-header', async () => {
  const React = await import('react');
  return { MultiHomeHeader: React.forwardRef<HTMLElement, any>((_props, ref) => <header ref={ref} />) };
});
vi.mock('../multi-home-footer', () => ({ MultiHomeFooter: () => <footer /> }));
vi.mock('../customer-footer', () => ({ CustomerFooter: () => <footer /> }));

const originalBodyStyle = document.body.getAttribute('style');
const originalPortalMarker = document.body.getAttribute('data-dealer-portal');
const originalCanonical = document.querySelector('meta[name="luxxy-canonical-origin"]')?.getAttribute('content');

function canonical(origin: string) {
  document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove();
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = origin;
  meta.setAttribute('data-dealer-portal-test', '');
  document.head.append(meta);
}

function page() {
  return <Layout><h1>Staff workspace</h1>{createPortal(<section role="dialog" aria-label="Staff pop-up"><button type="button">Continue</button></section>, document.body)}</Layout>;
}

beforeEach(() => {
  state.path = '/portal';
  state.settings = {
    ...dealerConfig,
    identity: { ...dealerConfig.identity, name: 'Future Dealer', logoAsset: '/future-dealer.svg', brandColors: { primaryHsl: '270 50% 25%', accentHsl: '12 60% 40%' } },
    presentation: { ...dealerConfig.presentation, pageColour: '#f8f0ff', panelColour: '#fff3eb' },
  };
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-dealer-portal-test]').forEach(element => element.remove());
  if (originalCanonical !== undefined) canonical(originalCanonical);
  if (originalBodyStyle === null) document.body.removeAttribute('style');
  else document.body.setAttribute('style', originalBodyStyle);
  if (originalPortalMarker === null) document.body.removeAttribute('data-dealer-portal');
  else document.body.setAttribute('data-dealer-portal', originalPortalMarker);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  ['https://multichoicemotors.co.uk', '/portal'],
  ['https://shoredrive.uk', '/portal'],
  ['https://future-dealer.example', '/portal/leads/customer-record'],
  ['http://localhost:4175', '/portal'],
])('applies the approved staff design at %s%s without changing dealership identity or saved settings', (origin, path) => {
  canonical(origin);
  state.path = path;
  const before = JSON.stringify(state.settings);
  const { container } = render(page());
  const shell = container.querySelector<HTMLElement>('.premium-portal.dealer-portal-theme');
  expect(shell).not.toBeNull();
  expect(shell?.style.getPropertyValue('--portal-ink')).toBe('#192a36');
  expect(shell?.style.getPropertyValue('--portal-canvas')).toBe('#f9fafb');
  expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
  expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
  expect(document.body.style.getPropertyValue('--portal-accent')).toBe('#192a36');
  expect(document.body.style.getPropertyValue('--mh-accent')).toBe('#a47a2b');
  expect(document.body).toContainElement(screen.getByRole('dialog', { name: 'Staff pop-up' }));
  expect(JSON.stringify(state.settings)).toBe(before);
});

it('keeps shared staff presentation when switching dealership and restores the previous body theme outside staff routes', () => {
  canonical('https://multichoicemotors.co.uk');
  document.body.style.setProperty('--portal-ink', '#123456');
  document.body.style.setProperty('--app-font-sans', 'Existing interface font');
  document.body.setAttribute('data-dealer-portal', 'previous-owner');
  const view = render(page());
  canonical('https://future-dealer.example');
  state.settings = { ...state.settings, identity: { ...state.settings.identity, name: 'Another Future Dealer', logoAsset: '/another-dealer.svg' } };
  view.rerender(page());
  expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
  expect(document.body.style.getPropertyValue('--portal-ink')).toBe('#192a36');
  state.path = '/platform';
  view.rerender(page());
  expect(document.body).toHaveAttribute('data-dealer-portal', 'previous-owner');
  expect(document.body.style.getPropertyValue('--portal-ink')).toBe('#123456');
  expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing interface font');
});

it('preserves document font boundaries for another dealership and its body-rendered print copies', () => {
  canonical('https://future-dealer.example');
  const sheet = document.createElement('style');
  sheet.setAttribute('data-dealer-portal-test', '');
  sheet.textContent = readFileSync('src/components/portal/dealer-portal-theme.css', 'utf8');
  document.head.append(sheet);
  const printCopy = createPortal(<article className="sales-print-copy invoice-sheet" data-testid="print-copy"><h2 className="font-display">Printed invoice</h2></article>, document.body);
  render(<Layout><h1>Staff heading</h1><article className="sales-document invoice-sheet" data-testid="invoice-document"><h2 className="font-display">Invoice</h2></article><article className="receipt-book" data-testid="receipt-document"><h2>Receipt</h2></article>{printCopy}</Layout>);
  expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
  for (const id of ['invoice-document', 'receipt-document', 'print-copy']) {
    const font = getComputedStyle(screen.getByTestId(id)).getPropertyValue('--app-font-sans');
    expect(font).toContain('Inter');
    expect(font).not.toContain('Multi Montserrat');
  }
});
