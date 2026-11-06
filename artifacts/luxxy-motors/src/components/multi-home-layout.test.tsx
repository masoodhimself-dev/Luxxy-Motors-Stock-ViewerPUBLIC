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
  expect(screen.getByTestId("new-home-header")).toBeInTheDocument();
  expect(screen.getByTestId("new-home-footer")).toBeInTheDocument();
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
    expect(screen.getByTestId("new-home-header")).toBeInTheDocument();
    expect(screen.getByTestId("new-home-footer")).toBeInTheDocument();
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
  expect(screen.getByTestId("new-home-header")).toHaveAttribute("data-logo", "/shore-home.svg");
  expect(screen.getByTestId("new-home-footer")).toHaveAttribute("data-logo", "/shore-home-footer.svg");
  expect(screen.getByTestId("new-home-header")).toHaveAttribute("data-name", "Multi-Choice Motors");
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
    expect(screen.getByTestId("new-home-header")).toBeInTheDocument();
    expect(screen.getByTestId("new-home-footer")).toBeInTheDocument();
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
  expect(screen.getByTestId("new-home-header")).toBeInTheDocument();
  expect(screen.getByTestId("new-home-footer")).toBeInTheDocument();
  expect(state.settings.identity.brandColors?.primaryHsl).toBe("0 0% 100%");
  expect(document.querySelector<HTMLElement>(".dealer-site-theme")?.style.getPropertyValue("--mh-primary")).toBe("#192a36");
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
  expect(screen.getByTestId("new-home-header")).toHaveAttribute(
    "data-logo",
    "/shore-logo.svg",
  );
  expect(screen.getByTestId("new-home-footer")).toHaveAttribute(
    "data-logo",
    "/shore-footer.svg",
  );
  expect(screen.getByTestId("new-home-footer")).toHaveAttribute("data-identity-logo", "/shore-logo.svg");
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
  expect(screen.getByTestId("new-home-footer")).toHaveAttribute(
    "data-enquiries-enabled",
    "true",
  );
  state.publicEnquiriesEnabled = false;
  rerender(
    <Layout>
      <p>Homepage</p>
    </Layout>,
  );
  expect(screen.getByTestId("new-home-footer")).toHaveAttribute(
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
  expect(screen.queryByTestId("new-home-header")).not.toBeInTheDocument();
  expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
  expect(document.querySelector("[data-site-header]")).toBeNull();
});

it.each(["isLoading", "isError"] as const)(
  "withholds build-time contact defaults while tenant settings are %s",
  (status) => {
    state.settings = dealerConfig;
    state[status] = true;
    render(
      <Layout>
        <p>Unready page content</p>
      </Layout>,
    );
    expect(
      screen.getByRole("img", { name: "Multi-Choice Motors" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unready page content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-home-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-home-footer")).not.toBeInTheDocument();
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
