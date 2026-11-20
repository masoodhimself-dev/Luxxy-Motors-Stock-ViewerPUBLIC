vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: null, isLoading: false, error: null }) }));
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dealerConfig } from "@/config/dealer";
const state = vi.hoisted(() => ({
  path: "/",
  settings: {} as typeof dealerConfig,
  publicEnquiriesEnabled: false,
  isLoading: false,
  isError: false,
  hasLoadedSettings: true,
}));
vi.mock("wouter", () => ({
  useLocation: () => [state.path, vi.fn()],
  useRoute: () => [false, null],
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: state.settings,
    publicEnquiriesEnabled: state.publicEnquiriesEnabled,
    isLoading: state.isLoading,
    isError: state.isError,
    hasLoadedSettings: state.hasLoadedSettings,
  }),
}));
vi.mock("@/lib/saved-cars-context", () => ({
  useSavedCars: () => ({ savedCount: 0 }),
}));
vi.mock("./multi-home-header", async () => {
  const React = await import("react");
  return {
    MultiHomeHeader: React.forwardRef<HTMLElement, any>(({ settings }, ref) => (
      <header ref={ref} data-testid="new-home-header" data-logo={settings.identity.logoAsset} data-name={settings.identity.name} />
    )),
  };
});
vi.mock("./multi-home-footer", () => ({
  MultiHomeFooter: ({ settings, enquiriesEnabled }: { settings: typeof dealerConfig; enquiriesEnabled: boolean }) => (
    <footer
      data-testid="new-home-footer"
      data-enquiries-enabled={String(enquiriesEnabled)}
      data-logo={settings.presentation?.footerLogoUrl || settings.identity.logoAsset}
      data-identity-logo={settings.identity.logoAsset}
      data-name={settings.identity.name}
    />
  ),
}));
vi.mock("./graphite/graphite-shell", async () => {
  const React = await import("react");
  return {
    GraphiteHeader: React.forwardRef<HTMLElement, any>(({ settings }, ref) => <header ref={ref} data-testid="graphite-header" data-logo={settings.identity.logoAsset} data-name={settings.identity.name} />),
    GraphiteFooter: ({ settings, enquiriesEnabled }: any) => <footer data-testid="graphite-footer" data-enquiries-enabled={String(enquiriesEnabled)} data-logo={settings.presentation?.footerLogoUrl || settings.identity.logoAsset} data-identity-logo={settings.identity.logoAsset} data-name={settings.identity.name} />,
  };
});
vi.mock("./customer-footer", () => ({
  CustomerFooter: ({ settings }: { settings: typeof dealerConfig }) => (
    <footer
      data-testid="existing-footer"
      data-logo={
        settings.presentation?.footerLogoUrl || settings.identity.logoAsset
      }
      data-identity-logo={settings.identity.logoAsset}
    />
  ),
}));
import { Layout } from "./layout";
import { websiteTemplatePalettes } from '@/lib/website-template-theme';
function canonical(value: string) {
  document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove();
  const meta = document.createElement("meta");
  meta.name = "luxxy-canonical-origin";
  meta.content = value;
  meta.dataset.pageMeta = "true";
  document.head.appendChild(meta);
}
beforeEach(() => {
  state.path = "/";
  state.publicEnquiriesEnabled = false;
  state.isLoading = false;
  state.isError = false;
  state.hasLoadedSettings = true;
  state.settings = {
    ...dealerConfig,
    identity: { ...dealerConfig.identity, name: "Multi-Choice Motors" },
  };
  canonical("https://multichoicemotors.co.uk");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove();
  vi.unstubAllGlobals();
});
it("uses the verified dealership homepage chrome and preserves skip/main landmarks", () => {
  const { container } = render(
    <Layout>
      <p>Homepage</p>
    </Layout>,
  );
  expect(container.querySelector(".multi-home-shell")).not.toBeNull();
  expect(container.querySelector(".dealer-site-theme")).not.toBeNull();
  expect(screen.getByTestId("graphite-header")).toBeInTheDocument();
  expect(screen.getByTestId("graphite-footer")).toBeInTheDocument();
  expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
});
it.each(["/stock", "/vehicle/car", "/cars/ford-focus-a1b2c3d4", "/s/a1b2c3d4", "/contact", "/saved", "/enquire"])(
  "shares the approved chrome on the customer %s page while retaining the homepage-only layout boundary",
  (path) => {
    state.path = path;
    const { container } = render(
      <Layout>
        <p>Other page</p>
      </Layout>,
    );
    expect(container.querySelector(".multi-home-shell")).toBeNull();
    expect(container.querySelector(".dealer-site-theme")).not.toBeNull();
    expect(screen.getByTestId("graphite-header")).toBeInTheDocument();
    expect(screen.getByTestId("graphite-footer")).toBeInTheDocument();
    expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
  },
);
it("applies the shared homepage design to another dealer while preserving its editable identity", () => {
  canonical("https://shoredrive.uk");
  state.settings = {
    ...state.settings,
    identity: { ...state.settings.identity, logoAsset: "/shore-home.svg" },
    presentation: { ...state.settings.presentation, footerLogoUrl: "/shore-home-footer.svg" },
  };
  const before = JSON.stringify(state.settings);
  const { container } = render(
    <Layout>
      <p>Another dealership</p>
    </Layout>,
  );
  expect(container.querySelector(".multi-home-shell.dealer-site-theme")).not.toBeNull();
  expect(screen.getByTestId("graphite-header")).toHaveAttribute("data-logo", "/shore-home.svg");
  expect(screen.getByTestId("graphite-footer")).toHaveAttribute("data-logo", "/shore-home-footer.svg");
  expect(screen.getByTestId("graphite-header")).toHaveAttribute("data-name", "Multi-Choice Motors");
  expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
  expect(JSON.stringify(state.settings)).toBe(before);
});
it.each(["/stock", "/vehicle/car", "/cars/ford-focus-a1b2c3d4", "/s/a1b2c3d4", "/contact", "/saved", "/enquire"])(
  "uses the shared public %s chrome without changing saved header or footer artwork",
  (path) => {
    state.path = path;
    state.settings = {
      ...state.settings,
      identity: {
        ...state.settings.identity,
        logoAsset: "/configured-old-logo.svg",
        brandColors: { primaryHsl: "195 22% 13%" },
      },
      presentation: {
        ...state.settings.presentation,
        footerLogoUrl: "/configured-old-footer.svg",
      },
    };
    render(
      <Layout>
        <p>Public page</p>
      </Layout>,
    );
    expect(screen.getByTestId("graphite-header")).toBeInTheDocument();
    expect(screen.getByTestId("graphite-footer")).toBeInTheDocument();
    expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
    expect(document.querySelector(".multi-home-shell")).toBeNull();
    expect(state.settings.identity.logoAsset).toBe("/configured-old-logo.svg");
    expect(state.settings.presentation?.footerLogoUrl).toBe(
      "/configured-old-footer.svg",
    );
  },
);
it("uses the shared public chrome without changing a previously saved light branding choice", () => {
  state.path = "/stock";
  state.settings = {
    ...state.settings,
    identity: {
      ...state.settings.identity,
      brandColors: { primaryHsl: "0 0% 100%" },
    },
  };
  render(
    <Layout>
      <p>Stock</p>
    </Layout>,
  );
  expect(screen.getByTestId("graphite-header")).toBeInTheDocument();
  expect(screen.getByTestId("graphite-footer")).toBeInTheDocument();
  expect(state.settings.identity.brandColors?.primaryHsl).toBe("0 0% 100%");
  expect(document.querySelector<HTMLElement>(".dealer-site-theme")?.style.getPropertyValue("--mh-primary")).toBe("#25282d");
});
it.each(Object.keys(websiteTemplatePalettes) as (keyof typeof websiteTemplatePalettes)[])('applies %s consistently to customer forms without changing saved dealership branding', template => {
  state.path = '/contact';
  state.settings = { ...state.settings, identity: { ...state.settings.identity, logoAsset: '/dealer-original.svg', brandColors: { primaryHsl: '0 0% 100%' } }, presentation: { ...state.settings.presentation, websiteTemplate: template } };
  const original = structuredClone(state.settings);
  const view = render(<Layout><p>Customer form</p></Layout>);
  const shell = view.container.querySelector<HTMLElement>('.website-template');
  expect(shell).toHaveAttribute('data-website-template', template);
  expect(shell).not.toHaveClass('graphite-site');
  expect(document.body).not.toHaveAttribute('data-customer-graphite');
  expect(shell?.style.getPropertyValue('--mh-primary')).toBe(websiteTemplatePalettes[template].ink);
  expect(shell?.style.getPropertyValue('--app-font-sans')).toContain(template === 'grand-touring' ? 'Manrope' : 'Inter');
  if (template === 'autodeal') {
    expect(shell?.style.getPropertyValue('--font-display')).toContain('Outfit');
    expect(document.body.style.getPropertyValue('--ad-orange')).toBe('#ff7101');
  }
  expect(document.body.style.getPropertyValue('--mh-accent')).toBe(websiteTemplatePalettes[template].action);
  expect(state.settings).toEqual(original);
  view.unmount();
  expect(document.body.style.getPropertyValue('--ct-ink')).toBe('');
});
it('does not carry an opted-in website palette into staff pages', () => {
  state.path = '/portal';
  state.settings = { ...state.settings, presentation: { ...state.settings.presentation, websiteTemplate: 'forecourt' } };
  const view = render(<Layout><p>Staff portal</p></Layout>);
  expect(view.container.querySelector('.website-template')).toBeNull();
  expect(document.body.style.getPropertyValue('--ct-ink')).toBe('');
});
it.each(["https://shoredrive.uk", "https://multichoicemotors.co.uk.other.example"])("preserves configured public artwork on %s even with the Multi-Choice display name", origin => {
  canonical(origin);
  state.path = "/stock";
  state.settings = {
    ...state.settings,
    identity: { ...state.settings.identity, logoAsset: "/shore-logo.svg" },
    presentation: {
      ...state.settings.presentation,
      footerLogoUrl: "/shore-footer.svg",
    },
  };
  render(
    <Layout>
      <p>Other dealership</p>
    </Layout>,
  );
  expect(screen.getByTestId("graphite-header")).toHaveAttribute(
    "data-logo",
    "/shore-logo.svg",
  );
  expect(screen.getByTestId("graphite-footer")).toHaveAttribute(
    "data-logo",
    "/shore-footer.svg",
  );
  expect(screen.getByTestId("graphite-footer")).toHaveAttribute("data-identity-logo", "/shore-logo.svg");
  expect(document.querySelector('[data-logo*="/brand/multi-choice-motors/"]')).toBeNull();
  expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
});
it("passes the feature-controlled public enquiry gate to the homepage footer", () => {
  state.publicEnquiriesEnabled = true;
  const { rerender } = render(
    <Layout>
      <p>Homepage</p>
    </Layout>,
  );
  expect(screen.getByTestId("graphite-footer")).toHaveAttribute(
    "data-enquiries-enabled",
    "true",
  );
  state.publicEnquiriesEnabled = false;
  rerender(
    <Layout>
      <p>Homepage</p>
    </Layout>,
  );
  expect(screen.getByTestId("graphite-footer")).toHaveAttribute(
    "data-enquiries-enabled",
    "false",
  );
});
it("keeps staff portal chrome owned by the portal", () => {
  state.path = "/portal";
  render(
    <Layout>
      <p>Portal</p>
    </Layout>,
  );
  expect(screen.queryByTestId("graphite-header")).not.toBeInTheDocument();
  expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
  expect(document.querySelector("[data-site-header]")).toBeNull();
});

it.each(["isLoading", "isError"] as const)(
  "withholds build-time contact defaults while tenant settings are %s",
  (status) => {
    state.settings = dealerConfig;
    state.hasLoadedSettings = false;
    state[status] = true;
    const { container } = render(
      <Layout>
        <p>Unready page content</p>
      </Layout>,
    );
    expect(container.querySelector('.graphite-site')).toHaveAttribute('data-default-website-design', 'graphite');
    expect(container.querySelector('[data-site-header]')).toHaveClass('gr-header');
    expect(
      screen.getByRole("img", { name: "Multi-Choice Motors" }),
    ).toHaveAttribute('src', '/brand/graphite/brand-wordmark.svg');
    expect(screen.queryByText("Unready page content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("graphite-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("graphite-footer")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    if (status === "isError")
      expect(
        screen.getByRole("button", { name: "Reload page" }),
      ).toBeInTheDocument();
    else
      expect(screen.getByRole("status")).toHaveTextContent(
        "Getting the dealership",
      );
  },
);

it.each(['/stock', '/contact', '/warranty', '/saved', '/enquire', '/cars/ford-focus-a1b2c3d4'].flatMap(path => ['isLoading', 'isError'].map(status => ({ path, status: status as 'isLoading' | 'isError' }))))('withholds fallback dealership details on an initial $path request while settings are $status', ({ path, status }) => {
  state.path = path;
  state.hasLoadedSettings = false;
  state[status] = true;
  canonical('https://harbourcars.example');
  const { container } = render(<Layout><p>Unready route content</p></Layout>);
  expect(container.querySelector('.graphite-site')).toHaveAttribute('data-default-website-design', 'graphite');
  expect(screen.getByText('Car showroom')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Multi.Choice Motors/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Unready route content')).not.toBeInTheDocument();
  expect(screen.queryByTestId('graphite-header')).not.toBeInTheDocument();
  expect(screen.queryByTestId('graphite-footer')).not.toBeInTheDocument();
  expect(screen.queryByTestId('existing-footer')).not.toBeInTheDocument();
  expect(document.querySelector('a[href^="tel:"],a[href^="mailto:"]')).toBeNull();
  if (status === 'isError') expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  else expect(screen.getByRole('status')).toHaveTextContent('Getting the dealership');
});

it.each(['/', '/contact'].flatMap(path => ['isLoading', 'isError'].map(status => ({ path, status: status as 'isLoading' | 'isError' }))))('keeps cached tenant branding and closed enquiry permissions on $path during background $status', ({ path, status }) => {
  state.path = path;
  state.hasLoadedSettings = true;
  state[status] = true;
  state.publicEnquiriesEnabled = false;
  state.settings = { ...dealerConfig, identity: { ...dealerConfig.identity, name: 'Harbour Cars', logoAsset: '/harbour.svg' } };
  canonical('https://harbourcars.example');
  render(<Layout><p>Loaded tenant content</p></Layout>);
  expect(screen.getByText('Loaded tenant content')).toBeInTheDocument();
  expect(screen.getByTestId('graphite-header')).toHaveAttribute('data-name', 'Harbour Cars');
  expect(screen.getByTestId('graphite-header')).toHaveAttribute('data-logo', '/harbour.svg');
  expect(screen.getByTestId('graphite-footer')).toHaveAttribute('data-name', 'Harbour Cars');
  expect(screen.getByTestId('graphite-footer')).toHaveAttribute('data-enquiries-enabled', 'false');
  expect(screen.queryByRole('button', { name: 'Reload page' })).not.toBeInTheDocument();
});

it('does not block staff portal content while public settings are loading', () => {
  state.path = '/portal'; state.hasLoadedSettings = false; state.isLoading = true;
  render(<Layout><p>Staff workspace</p></Layout>);
  expect(screen.getByText('Staff workspace')).toBeInTheDocument();
  expect(screen.queryByText('Loading the dealership…')).not.toBeInTheDocument();
  expect(screen.queryByTestId('graphite-header')).not.toBeInTheDocument();
});

it('opens an initially loading customer route once its own settings arrive', () => {
  state.path = '/stock'; state.hasLoadedSettings = false; state.isLoading = true;
  canonical('https://harbourcars.example');
  const view = render(<Layout><p>Current stock</p></Layout>);
  expect(screen.queryByText('Current stock')).not.toBeInTheDocument();
  state.settings = { ...dealerConfig, identity: { ...dealerConfig.identity, name: 'Harbour Cars', logoAsset: '/harbour.svg' } };
  state.hasLoadedSettings = true; state.isLoading = false;
  view.rerender(<Layout><p>Current stock</p></Layout>);
  expect(screen.getByText('Current stock')).toBeInTheDocument();
  expect(screen.getByTestId('graphite-header')).toHaveAttribute('data-name', 'Harbour Cars');
  expect(screen.getByTestId('graphite-footer')).toHaveAttribute('data-name', 'Harbour Cars');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
