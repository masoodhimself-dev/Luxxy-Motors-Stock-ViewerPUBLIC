vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: null, isLoading: false, error: null }) }));
import { readFileSync } from 'node:fs';
import { createPortal } from 'react-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { multiCustomerThemeVariables, multiPortalThemeVariables } from '@/lib/multi-customer-theme';
import { Layout } from './layout';
import { UKNumberPlate } from './uk-number-plate';
import { CustomerDocumentTheme } from './multi-customer-theme';

const state = vi.hoisted(() => ({
  path: '/stock',
  settings: {} as typeof dealerConfig,
  loading: false,
  error: false,
}));
vi.mock('wouter', () => ({
  useLocation: () => [state.path, vi.fn()],
  useRoute: () => [false, null],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: state.settings, publicEnquiriesEnabled: true, isLoading: state.loading, isError: state.error }),
}));
vi.mock('@/lib/saved-cars-context', () => ({ useSavedCars: () => ({ savedCount: 0 }) }));
vi.mock('@/hooks/use-stock-header', () => ({ useStockHeader: () => ({ hidden: false, reveal: vi.fn() }) }));
vi.mock('./multi-home-header', async () => {
  const React = await import('react');
  return { MultiHomeHeader: React.forwardRef<HTMLElement, any>(({ settings }, ref) => <header ref={ref} data-testid="multi-theme-header" data-logo={settings.identity.logoAsset} data-name={settings.identity.name} />) };
});
vi.mock('./multi-home-footer', () => ({ MultiHomeFooter: ({ settings }: any) => <footer data-testid="multi-theme-footer" data-logo={settings.presentation?.footerLogoUrl || settings.identity.logoAsset} data-name={settings.identity.name} /> }));
vi.mock('./customer-footer', () => ({ CustomerFooter: () => <footer data-testid="other-dealer-footer" /> }));

function canonical(origin: string) {
  document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove();
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = origin;
  meta.setAttribute('data-page-meta', '');
  meta.setAttribute('data-multi-theme-test', '');
  document.head.append(meta);
}

function PortalContents() {
  return createPortal(<section role="dialog" aria-label="Customer pop-up"><button type="button">Continue enquiry</button></section>, document.body);
}

function page() {
  return <Layout><h1>Customer page</h1><PortalContents /></Layout>;
}

const originalBodyStyle = document.body.getAttribute('style');
const originalMarker = document.body.getAttribute('data-dealer-customer');
const originalPortalMarker = document.body.getAttribute('data-dealer-portal');

beforeEach(() => {
  state.path = '/stock';
  state.loading = false;
  state.error = false;
  state.settings = {
    ...dealerConfig,
    identity: { ...dealerConfig.identity, name: 'Multi-Choice Motors', logoAsset: '/configured-dealer.svg', brandColors: { primaryHsl: '220 50% 20%', accentHsl: '210 60% 40%' } },
    presentation: { ...dealerConfig.presentation, pageColour: '#edf2f4', panelColour: '#fff4e6', footerLogoUrl: '/configured-footer.svg' },
  };
  canonical('https://multichoicemotors.co.uk');
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-multi-theme-test]').forEach(element => element.remove());
  if (originalBodyStyle === null) document.body.removeAttribute('style');
  else document.body.setAttribute('style', originalBodyStyle);
  if (originalMarker === null) document.body.removeAttribute('data-dealer-customer');
  else document.body.setAttribute('data-dealer-customer', originalMarker);
  if (originalPortalMarker === null) document.body.removeAttribute('data-dealer-portal');
  else document.body.setAttribute('data-dealer-portal', originalPortalMarker);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Shared dealership customer theme scope', () => {
  it('provides the approved homepage palette and shared font without changing saved dealer settings', () => {
    const before = JSON.stringify(state.settings);
    const variables = multiCustomerThemeVariables();
    expect(variables).toMatchObject({
      '--mh-primary': '#192a36', '--mh-accent': '#a47a2b', '--mh-accent-dark': '#7c591a',
      '--mh-bg': '#f9fafb', '--mh-surface': '#ffffff', '--mh-tint': '#eef9fc',
      '--mh-muted': '#59656e', '--mh-border': '#e1e5e8',
      '--dealer-page': '#f9fafb', '--dealer-panel': '#ffffff',
      '--app-font-sans': "'Multi Montserrat', Arial, sans-serif",
    });
    expect(variables['--font-display']).toContain('Multi Montserrat');
    expect(variables['--font-body']).toContain('Multi Montserrat');
    expect(JSON.stringify(state.settings)).toBe(before);
  });

  it.each(['/', '/stock', '/vehicle/current-car', '/saved', '/enquire', '/contact', '/warranty', '/viewing/booking-token'])(
    'applies navy to the Multi-Choice %s shell and its body-rendered pop-ups', path => {
      state.path = path;
      const { container } = render(page());
      const shell = container.querySelector<HTMLElement>('.customer-site.dealer-site-theme');
      expect(shell).not.toBeNull();
      expect(shell).toHaveClass('showroom-navy-site');
      expect(shell?.style.getPropertyValue('--dealer-page')).toBe('#f6f7f9');
      expect(shell?.style.getPropertyValue('--mh-accent')).toBe('#182957');
      expect(shell?.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
      expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
      expect(document.body.style.getPropertyValue('--mh-primary')).toBe('#182235');
      expect(document.body.style.getPropertyValue('--dialog-accent')).toBe('#182957');
      expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
      const popup = screen.getByRole('dialog', { name: 'Customer pop-up' });
      expect(document.body).toContainElement(popup);
      expect(shell).not.toContainElement(popup);
      expect(shell?.classList.contains('multi-home-shell')).toBe(path === '/');
    },
  );

  it.each(['/platform', '/sign-in', '/sign-in/sso-callback', '/sign-up', '/join'])(
    'excludes account route %s even on the verified dealership domain', path => {
      state.path = path;
      document.body.style.setProperty('--app-font-sans', 'Existing staff font');
      const { container } = render(page());
      expect(container.querySelector('.dealer-site-theme')).toBeNull();
      expect(document.body).not.toHaveAttribute('data-dealer-customer');
      expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing staff font');
      expect(document.body.style.getPropertyValue('--mh-primary')).toBe('');
    },
  );

  it('uses the same presentation for another dealership without changing its editable identity or saved settings', () => {
    canonical('https://shoredrive.uk');
    const before = JSON.stringify(state.settings);
    const { container } = render(page());
    const shell = container.querySelector<HTMLElement>('.customer-site')!;
    expect(shell).toHaveClass('dealer-site-theme');
    expect(shell).not.toHaveClass('showroom-navy-site');
    expect(shell.style.getPropertyValue('--dealer-page')).toBe('#f9fafb');
    expect(shell.style.getPropertyValue('--dealer-panel')).toBe('#ffffff');
    expect(shell.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(screen.getByTestId('multi-theme-header')).toHaveAttribute('data-logo', '/configured-dealer.svg');
    expect(screen.getByTestId('multi-theme-footer')).toHaveAttribute('data-logo', '/configured-footer.svg');
    expect(JSON.stringify(state.settings)).toBe(before);
  });

  it('keeps navy on the verified www domain and the shared theme on lookalike domains', () => {
    canonical('https://www.multichoicemotors.co.uk');
    const view = render(page());
    expect(view.container.querySelector('.dealer-site-theme')).toHaveClass('showroom-navy-site');
    canonical('https://multichoicemotors.co.uk.other.example');
    const before = JSON.stringify(state.settings);
    view.rerender(page());
    expect(view.container.querySelector('.dealer-site-theme')).not.toHaveClass('showroom-navy-site');
    expect(document.body.style.getPropertyValue('--dealer-page')).toBe('#f9fafb');
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(screen.getByTestId('multi-theme-header')).toHaveAttribute('data-logo', '/configured-dealer.svg');
    expect(screen.getByTestId('multi-theme-footer')).toHaveAttribute('data-logo', '/configured-footer.svg');
    expect(JSON.stringify(state.settings)).toBe(before);
  });

  it('restores pre-existing body tokens and marker exactly when the customer shell unmounts', () => {
    document.body.setAttribute('data-dealer-customer', 'previous-owner');
    document.body.style.setProperty('--app-font-sans', 'Existing interface font');
    document.body.style.setProperty('--mh-primary', '#123456');
    document.body.style.setProperty('--dealer-page', '#abcdef');
    document.body.style.setProperty('--unrelated-token', 'keep-me');
    const { unmount } = render(page());
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(document.body.style.getPropertyValue('--mh-primary')).toBe('#182235');
    unmount();
    expect(document.body).toHaveAttribute('data-dealer-customer', 'previous-owner');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing interface font');
    expect(document.body.style.getPropertyValue('--mh-primary')).toBe('#123456');
    expect(document.body.style.getPropertyValue('--dealer-page')).toBe('#abcdef');
    expect(document.body.style.getPropertyValue('--unrelated-token')).toBe('keep-me');
  });

  it('switches public and staff markers, shares presentation across dealerships, and restores tokens outside customer routes', () => {
    document.body.style.setProperty('--app-font-sans', 'Existing interface font');
    const view = render(page());
    state.path = '/contact';
    view.rerender(page());
    expect(view.container.querySelector('.dealer-site-theme')).not.toBeNull();
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    state.path = '/portal';
    view.rerender(page());
    expect(view.container.querySelector('.dealer-site-theme')).toBeNull();
    expect(document.body).not.toHaveAttribute('data-dealer-customer');
    expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
    state.path = '/saved';
    view.rerender(page());
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(document.body).not.toHaveAttribute('data-dealer-portal');
    canonical('https://shoredrive.uk');
    view.rerender(page());
    expect(view.container.querySelector('.dealer-site-theme')).not.toBeNull();
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
    expect(document.body.style.getPropertyValue('--dealer-page')).toBe('#f9fafb');
    state.path = '/platform';
    view.rerender(page());
    expect(document.body).not.toHaveAttribute('data-dealer-customer');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing interface font');
    expect(document.body.style.getPropertyValue('--dealer-page')).toBe('');
  });

  it.each(['/portal', '/portal/leads/example'])('uses the homepage font and palette in the verified %s shell and body pop-ups', path => {
    state.path = path;
    const before = JSON.stringify(state.settings);
    const { container } = render(page());
    const shell = container.querySelector<HTMLElement>('.premium-portal.dealer-portal-theme');
    expect(shell).not.toBeNull();
    expect(shell).not.toHaveClass('showroom-navy-site');
    expect(shell?.style.getPropertyValue('--portal-ink')).toBe('#192a36');
    expect(shell?.style.getPropertyValue('--portal-canvas')).toBe('#f9fafb');
    expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
    expect(document.body).not.toHaveAttribute('data-dealer-customer');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
    expect(document.body.style.getPropertyValue('--portal-accent')).toBe('#192a36');
    expect(document.body).toContainElement(screen.getByRole('dialog'));
    expect(JSON.stringify(state.settings)).toBe(before);
    expect(multiPortalThemeVariables()['--mh-accent']).toBe(multiCustomerThemeVariables()['--mh-accent']);
  });

  it('restores the prior body theme outside portal routes and reapplies the shared portal presentation for another tenant', () => {
    state.path = '/portal';
    document.body.style.setProperty('--app-font-sans', 'Existing interface font');
    document.body.style.setProperty('--portal-accent', '#123456');
    const view = render(page());
    expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
    state.path = '/platform';
    view.rerender(page());
    expect(document.body).not.toHaveAttribute('data-dealer-portal');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing interface font');
    expect(document.body.style.getPropertyValue('--portal-accent')).toBe('#123456');
    state.path = '/portal';
    canonical('https://shoredrive.uk');
    view.rerender(page());
    expect(view.container.querySelector('.dealer-portal-theme')).not.toBeNull();
    expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
    state.path = '/sign-in';
    view.rerender(page());
    expect(document.body).not.toHaveAttribute('data-dealer-portal');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing interface font');
  });

  it('restores prior body tokens and marker exactly on portal unmount', () => {
    state.path = '/portal';
    document.body.setAttribute('data-dealer-portal', 'previous-owner');
    document.body.style.setProperty('--portal-ink', '#123456');
    document.body.style.setProperty('--app-font-sans', 'Existing interface font');
    const { unmount } = render(page());
    expect(document.body).toHaveAttribute('data-dealer-portal', 'true');
    unmount();
    expect(document.body).toHaveAttribute('data-dealer-portal', 'previous-owner');
    expect(document.body.style.getPropertyValue('--portal-ink')).toBe('#123456');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toBe('Existing interface font');
  });

  it('keeps document and print-copy font tokens isolated from portal headings', () => {
    state.path = '/portal';
    const sheet = document.createElement('style');
    sheet.setAttribute('data-multi-theme-test', '');
    sheet.textContent = readFileSync('src/components/portal/dealer-portal-theme.css', 'utf8');
    document.head.append(sheet);
    const printCopy = createPortal(<article className="sales-print-copy invoice-sheet" data-testid="print-copy"><h2 className="font-display">Printed invoice</h2></article>, document.body);
    render(<Layout><h1>Portal heading</h1><article className="sales-document invoice-sheet" data-testid="invoice-document"><h2 className="font-display">Invoice heading</h2></article>{printCopy}</Layout>);
    expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
    for (const id of ['invoice-document', 'print-copy']) {
      const font = getComputedStyle(screen.getByTestId(id)).getPropertyValue('--app-font-sans');
      expect(font).toContain('Inter');
      expect(font).not.toContain('Multi Montserrat');
    }
  });

  it.each(['loading', 'error'] as const)('retains the shared visual theme while settings are %s', status => {
    state.path = '/';
    state[status] = true;
    const { container } = render(page());
    expect(container.querySelector('.customer-site.dealer-site-theme')).not.toBeNull();
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    expect(document.body.style.getPropertyValue('--app-font-sans')).toContain('Multi Montserrat');
  });

  it('themes a minimal public document without adding navigation or changing its contents', () => {
    const { container, unmount } = render(<CustomerDocumentTheme><article><h1>Private document preview</h1><p>Document contents remain unchanged.</p></article></CustomerDocumentTheme>);
    expect(container.querySelector('.dealer-site-theme.dealer-document-theme')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Private document preview' })).toBeInTheDocument();
    expect(screen.getByText('Document contents remain unchanged.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(document.body).toHaveAttribute('data-dealer-customer', 'true');
    unmount();
    expect(document.body).not.toHaveAttribute('data-dealer-customer');
  });

  it('keeps specialist plate lettering on the page and inside body pop-ups while ordinary controls use Montserrat', () => {
    const sheet = document.createElement('style');
    sheet.setAttribute('data-multi-theme-test', '');
    // The shared theme loads last to exercise the actual cascade risk.
    sheet.textContent = [
      'src/components/registration-plate/styles/registration-plate.css',
      'src/components/uk-number-plate.css',
      'src/components/multi-customer-theme.css',
    ].map(path => readFileSync(path, 'utf8').replace(/^@import[^;]+;\s*$/gm, '')).join('\n');
    document.head.append(sheet);
    const popup = createPortal(<section role="dialog" aria-label="Registration pop-up"><button type="button">Continue</button><UKNumberPlate value="EF34 GHJ" editable inputLabel="Pop-up registration" /></section>, document.body);
    render(<Layout><UKNumberPlate value="AB12 CDE" testId="display-plate" /><UKNumberPlate value="AB12 CDE" editable inputLabel="Part-exchange registration" /><label>Name<input aria-label="Customer name" /></label>{popup}</Layout>);
    const display = screen.getByTestId('display-plate').querySelector<HTMLElement>('.ukrp-text')!;
    const editable = screen.getByRole('textbox', { name: 'Part-exchange registration' });
    expect(getComputedStyle(display).fontFamily).toContain('Forecourt Plate UK');
    expect(getComputedStyle(editable).fontFamily).toMatch(/Forecourt Plate UK|--app-registration-font/);
    expect(getComputedStyle(display).fontFamily).not.toContain('Multi Montserrat');
    expect(getComputedStyle(editable).fontFamily).not.toContain('Multi Montserrat');
    expect(getComputedStyle(display).fontWeight).toBe('400');
    expect(getComputedStyle(editable).fontWeight).toBe('400');
    expect(editable).toHaveValue('AB12 CDE');
    const popupPlate = screen.getByRole('textbox', { name: 'Pop-up registration' });
    expect(getComputedStyle(popupPlate).fontFamily).toMatch(/Forecourt Plate UK|--app-registration-font/);
    expect(getComputedStyle(popupPlate).fontWeight).toBe('400');
    expect(getComputedStyle(screen.getByRole('textbox', { name: 'Customer name' })).fontFamily).toContain('Multi Montserrat');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Continue' })).fontFamily).toContain('Multi Montserrat');
  });
});
