import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dealerConfig } from "@/config/dealer";
const state = vi.hoisted(() => ({
  path: "/",
  settings: {} as typeof dealerConfig,
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
    publicEnquiriesEnabled: false,
  }),
}));
vi.mock("@/lib/saved-cars-context", () => ({
  useSavedCars: () => ({ savedCount: 0 }),
}));
vi.mock("./multi-home-header", async () => {
  const React = await import("react");
  return {
    MultiHomeHeader: React.forwardRef<HTMLElement, any>((_props, ref) => (
      <header ref={ref} data-testid="new-home-header" />
    )),
  };
});
vi.mock("./multi-home-footer", () => ({
  MultiHomeFooter: () => <footer data-testid="new-home-footer" />,
}));
vi.mock("./customer-footer", () => ({
  CustomerFooter: () => <footer data-testid="existing-footer" />,
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
it("replaces only the exact dealership homepage chrome and preserves skip/main landmarks", () => {
  const { container } = render(
    <Layout>
      <p>Homepage</p>
    </Layout>,
  );
  expect(container.querySelector(".multi-home-shell")).not.toBeNull();
  expect(screen.getByTestId("new-home-header")).toBeInTheDocument();
  expect(screen.getByTestId("new-home-footer")).toBeInTheDocument();
  expect(screen.queryByTestId("existing-footer")).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
});
it.each(["/stock", "/vehicle/car", "/contact", "/saved", "/enquire"])(
  "retains existing chrome on the same dealership’s %s page",
  (path) => {
    state.path = path;
    const { container } = render(
      <Layout>
        <p>Other page</p>
      </Layout>,
    );
    expect(container.querySelector(".multi-home-shell")).toBeNull();
    expect(screen.queryByTestId("new-home-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("existing-footer")).toBeInTheDocument();
  },
);
it("does not apply the homepage design to another dealer with the same editable name", () => {
  canonical("https://shoredrive.uk");
  const { container } = render(
    <Layout>
      <p>Another dealership</p>
    </Layout>,
  );
  expect(container.querySelector(".multi-home-shell")).toBeNull();
  expect(screen.queryByTestId("new-home-header")).not.toBeInTheDocument();
  expect(screen.getByTestId("existing-footer")).toBeInTheDocument();
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
