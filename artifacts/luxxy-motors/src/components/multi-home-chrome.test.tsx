import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dealerConfig } from "@/config/dealer";
import { MultiHomeHeader, type MultiHomeSettings } from "./multi-home-header";
import { MultiHomeFooter } from "./multi-home-footer";
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("wouter", () => ({
  Link: ({ href, children, onClick, ...props }: any) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        )
          router.navigate(href);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
const config = (): MultiHomeSettings => ({
  ...dealerConfig,
  identity: { ...dealerConfig.identity, name: "Multi-Choice Motors" },
  contact: { phone: "02046286488" },
  presentation: { servicesEnabled: true },
  legal: { companyName: "Multichoice Motors Ltd" },
  testDriveBooking: { enabled: false },
});
beforeEach(() => {
  router.navigate.mockReset();
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = 'https://multichoicemotors.co.uk';
  meta.setAttribute('data-page-meta', '');
  meta.setAttribute('data-public-chrome-test', '');
  document.head.append(meta);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-public-chrome-test]').forEach(node => node.remove());
});

it('uses another dealership’s own logos, contact details and name in the shared chrome', () => {
  document.querySelector<HTMLMetaElement>('[data-public-chrome-test]')!.content = 'https://shoredrive.uk';
  const settings = { ...config(), identity: { name: 'Shore Drive', logoAsset: '/shore-logo.svg' }, contact: { phone: '02079460123' }, legal: { companyName: 'Shore Drive Ltd' }, presentation: { footerLogoUrl: '/shore-footer.svg' } };
  const before = JSON.stringify(settings);
  const view = render(<><MultiHomeHeader settings={settings} savedCount={0} testDriveHref="/enquire?type=viewing" /><MultiHomeFooter settings={settings} /></>);
  expect(view.container.querySelector('header img')).toHaveAttribute('src', '/shore-logo.svg');
  expect(view.container.querySelector('footer img')).toHaveAttribute('src', '/shore-footer.svg');
  expect(screen.getByRole('link', { name: /Call Shore Drive/ })).toHaveAttribute('href', 'tel:02079460123');
  expect(screen.getByText(/Shore Drive Ltd/)).toBeInTheDocument();
  expect(view.container.innerHTML).not.toContain('/brand/multi-choice-motors/multi-choice-wordmark');
  expect(JSON.stringify(settings)).toBe(before);
});

it.each([
  ['https://shoredrive.uk', true],
  ['https://www.shoredrive.uk', true],
  ['https://new-dealer.co.uk', false],
])('scopes the fitted Shore Drive wordmarks to the original assets on %s', (origin, fitted) => {
  document.querySelector<HTMLMetaElement>('[data-public-chrome-test]')!.content = origin;
  const headerLogo = '/api/website-assets/d01af3ae-0a7c-4711-83ab-0dec2e0e7a84';
  const footerLogo = 'https://www.shoredrive.uk/api/website-assets/f0c45054-168c-452c-a572-83327ac212a6';
  const settings = { ...config(), identity: { name: 'Shore Drive', logoAsset: headerLogo }, presentation: { footerLogoUrl: footerLogo } };
  const view = render(<><MultiHomeHeader settings={settings} savedCount={0} testDriveHref="/enquire?type=viewing" /><MultiHomeFooter settings={settings} /></>);

  expect(view.container.querySelector('header img')).toHaveAttribute('src', fitted ? '/brand/shore-drive/shore-drive-wordmark.svg' : headerLogo);
  expect(view.container.querySelector('footer img')).toHaveAttribute('src', fitted ? '/brand/shore-drive/shore-drive-wordmark-white.svg' : footerLogo);
});

it('keeps a dealership name visible when no uploaded logo is configured', () => {
  document.querySelector<HTMLMetaElement>('[data-public-chrome-test]')!.content = 'https://new-dealer.example';
  const settings = { ...config(), identity: { name: 'New Dealership' } };
  render(<MultiHomeHeader settings={settings} savedCount={0} testDriveHref="/enquire?type=viewing" />);
  expect(screen.getByRole('link', { name: 'New Dealership home' })).toHaveTextContent('New Dealership');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it.each([
  { primaryHsl: '210 50% 20%', background: 'rgb(26, 51, 77)', foreground: 'rgb(255, 255, 255)', logo: '/shore-white-footer.svg' },
  { primaryHsl: '0 0% 100%', background: 'rgb(255, 255, 255)', foreground: 'rgb(20, 20, 20)', logo: '/shore-dark-footer.svg' },
  { primaryHsl: undefined, background: 'rgb(25, 42, 54)', foreground: 'rgb(255, 255, 255)', logo: '/shore-white-footer.svg' },
])('keeps custom footer logo $logo on its original $background surface and removes that panel when cleared', ({ primaryHsl, background, foreground, logo }) => {
  document.querySelector<HTMLMetaElement>('[data-public-chrome-test]')!.content = 'https://shoredrive.uk';
  const settings = { ...config(), identity: { name: 'Shore Drive', logoAsset: '/shore-header.svg', brandColors: { primaryHsl } }, presentation: { footerLogoUrl: logo } };
  const before = JSON.stringify(settings);
  const view = render(<MultiHomeFooter settings={settings} />);
  const brand = screen.getByRole('link', { name: 'Shore Drive home' });
  expect(brand).toHaveClass('multi-home-footer__brand--custom');
  expect(brand).toHaveStyle({ backgroundColor: background, color: foreground });
  expect(within(brand).getByRole('img')).toHaveAttribute('src', logo);
  expect(JSON.stringify(settings)).toBe(before);
  view.rerender(<MultiHomeFooter settings={{ ...settings, presentation: { footerLogoUrl: '' } }} />);
  expect(brand).not.toHaveClass('multi-home-footer__brand--custom');
  expect(brand.style.backgroundColor).toBe('');
  expect(within(brand).getByRole('img')).toHaveAttribute('src', '/shore-header.svg');
});

it('gives custom footer assets room inside their contrasting logo panel', () => {
  const css = readFileSync(`${process.cwd()}/src/components/multi-home-chrome.css`, 'utf8');
  expect(css).toMatch(/\.multi-home-footer__brand--custom\s*\{[^}]*box-sizing:\s*content-box;[^}]*padding:\s*10px 16px;[^}]*border-radius:\s*8px;/);
});
it("uses the original vector logo and published phone with compact, functional navigation", () => {
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={2}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  expect(
    screen.getByRole("img", { name: "Multi-Choice Motors" }),
  ).toHaveAttribute(
    "src",
    "/brand/multi-choice-motors/multi-choice-wordmark.svg",
  );
  expect(
    screen.getByRole("img", { name: "Multi-Choice Motors" }),
  ).toHaveAttribute("width", "205");
  expect(screen.getByRole("link", { name: "Search cars" })).toHaveAttribute(
    "href",
    "/stock",
  );
  expect(
    screen.getByRole("link", { name: /Call Multi-Choice Motors/ }),
  ).toHaveAttribute("href", "tel:02046286488");
  expect(
    screen.queryByRole("link", { name: "Reviews" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Saved cars (2)" })).toHaveAttribute(
    "href",
    "/saved",
  );
  expect(screen.getByRole("link", { name: "About us" })).toHaveAttribute(
    "href",
    "#about",
  );
  expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
    "href",
    "#contact",
  );
  expect(
    screen.queryByRole("button", { name: "More links" }),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("link", { name: /Call Multi-Choice Motors/ })
      .querySelector("svg"),
  ).toHaveClass("lucide-phone");
  expect(
    screen.queryByRole("link", { name: dealerConfig.bookViewing.ctaLabel }),
  ).not.toBeInTheDocument();
});
it("offers enabled services in a disclosure and closes it after following a link", async () => {
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  expect(screen.getByRole("link", { name: "Warranty" })).toHaveAttribute(
    "href",
    "/warranty",
  );
  fireEvent.click(screen.getByRole("link", { name: "Delivery" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "Services" }),
    ).not.toBeInTheDocument(),
  );
});
it("does not expose disabled services, part exchange or booking in either navigation", async () => {
  const settings = config();
  settings.warranty = { ...settings.warranty!, enabled: false };
  settings.delivery = { ...settings.delivery!, enabled: false };
  settings.partExchange = { ...settings.partExchange!, enabled: false };
  render(
    <MultiHomeHeader
      settings={settings}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Services" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Part exchange" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  const nav = within(
    screen.getByRole("navigation", { name: "Mobile navigation" }),
  );
  for (const name of [
    "Warranty",
    "Delivery",
    "Part exchange",
    dealerConfig.bookViewing.ctaLabel,
  ])
    expect(nav.queryByRole("link", { name })).not.toBeInTheDocument();
  expect(nav.getByRole("link", { name: "Saved cars" })).toHaveAttribute(
    "href",
    "/saved",
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("moves focus into the mobile drawer and returns it to the trigger on Escape", async () => {
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  const trigger = screen.getByRole("button", { name: "Open navigation menu" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Multi-Choice Motors" });
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("closes the mobile drawer when the viewport changes to desktop", async () => {
  vi.stubGlobal("innerWidth", 390);
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  vi.stubGlobal("innerWidth", 1280);
  fireEvent(window, new Event("resize"));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("keeps the enabled booking route in the clearly labelled Services menu", async () => {
  const settings = config();
  settings.testDriveBooking = { enabled: true };
  render(
    <MultiHomeHeader
      settings={settings}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  expect(
    screen.queryByRole("link", { name: settings.bookViewing.ctaLabel }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  expect(
    screen.getByRole("link", { name: settings.bookViewing.ctaLabel }),
  ).toHaveAttribute("href", "/enquire?type=viewing");
});
it("offers booking independently when optional warranty and delivery sections are off", () => {
  const settings = config();
  settings.presentation = { servicesEnabled: false };
  settings.testDriveBooking = { enabled: true };
  render(
    <MultiHomeHeader
      settings={settings}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  const services = within(screen.getByRole("navigation", { name: "Services" }));
  expect(
    services.getByRole("link", { name: settings.bookViewing.ctaLabel }),
  ).toHaveAttribute("href", "/enquire?type=viewing");
  expect(
    services.queryByRole("link", { name: "Warranty" }),
  ).not.toBeInTheDocument();
  expect(
    services.queryByRole("link", { name: "Delivery" }),
  ).not.toBeInTheDocument();
});
it("closes a desktop Services disclosure when resizing to phone navigation", async () => {
  vi.stubGlobal("innerWidth", 1440);
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  expect(
    screen.getByRole("navigation", { name: "Services" }),
  ).toBeInTheDocument();
  vi.stubGlobal("innerWidth", 390);
  fireEvent(window, new Event("resize"));
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "Services" }),
    ).not.toBeInTheDocument(),
  );
});
it("closes the mobile drawer on navigation and includes Reviews only for actual configured evidence", async () => {
  const settings = config();
  settings.presentation = {
    ...settings.presentation,
    reviewsUrl: "https://reviews.example.test/dealer",
  };
  render(
    <MultiHomeHeader
      settings={settings}
      savedCount={1}
      testDriveHref="/enquire?type=viewing"
    />,
  );
  expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute(
    "href",
    "#reviews",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Mobile navigation" }),
    ).getByRole("link", { name: "Search cars" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("keeps the footer compact and uses only supplied company and legal details", () => {
  const settings = config();
  settings.legal = {
    companyName: "Multichoice Motors Ltd",
    companyNumber: "12345678",
    privacyUrl: "/privacy",
    termsUrl: "/terms",
    cookieUrl: "/cookies",
  };
  render(<MultiHomeFooter settings={settings} />);
  expect(
    screen.getByRole("img", { name: "Multi-Choice Motors" }),
  ).toHaveAttribute("height", "40");
  expect(
    screen.getByText(/Multichoice Motors Ltd. All rights reserved/),
  ).toBeVisible();
  expect(screen.getByText("Company no. 12345678")).toBeVisible();
  expect(screen.queryByText(/VAT no/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  expect(
    screen.queryByText(/Opening hours|020 4628 6488|Hayes/),
  ).not.toBeInTheDocument();
});
it("preserves configured social profiles without inventing links or accepting unsafe URLs", () => {
  const settings = config();
  settings.social = {
    instagram: "https://www.instagram.com/multichoicemotors/",
    facebook: "https://www.facebook.com/multichoicemotors/",
    twitter: "https://x.com/multichoicemotors",
  };
  const { rerender } = render(<MultiHomeFooter settings={settings} />);
  const social = within(screen.getByRole("navigation", { name: "Follow us" }));
  for (const [name, href] of [
    ["Instagram", settings.social.instagram],
    ["Facebook", settings.social.facebook],
    ["X / Twitter", settings.social.twitter],
  ]) {
    const link = social.getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  settings.social = {
    instagram: "javascript:alert(1)",
    facebook: "https://user:password@example.com",
    twitter: "",
  };
  rerender(<MultiHomeFooter settings={settings} />);
  expect(
    screen.queryByRole("navigation", { name: "Follow us" }),
  ).not.toBeInTheDocument();
});
it("offers the public enquiry route only when its feature is allowed", () => {
  const settings = config();
  const { rerender } = render(<MultiHomeFooter settings={settings} />);
  expect(
    screen.queryByRole("link", { name: "Send an enquiry" }),
  ).not.toBeInTheDocument();
  rerender(<MultiHomeFooter settings={settings} enquiriesEnabled />);
  expect(screen.getByRole("link", { name: "Send an enquiry" })).toHaveAttribute(
    "href",
    "/enquire?type=general",
  );
  rerender(<MultiHomeFooter settings={settings} enquiriesEnabled={false} />);
  expect(
    screen.queryByRole("link", { name: "Send an enquiry" }),
  ).not.toBeInTheDocument();
});

it("uses actual customer routes and homepage section links from a non-homepage header", async () => {
  const settings = config();
  settings.presentation = {
    ...settings.presentation,
    reviewsUrl: "https://reviews.example.test/dealer",
  };
  settings.testDriveBooking = { enabled: true };
  render(
    <MultiHomeHeader
      settings={settings}
      savedCount={3}
      testDriveHref="/enquire?type=viewing&vehicleId=car-1"
      isHomepage={false}
    />,
  );
  const desktop = within(
    screen.getByRole("navigation", { name: "Primary navigation" }),
  );
  expect(
    screen.getByRole("link", { name: "Multi-Choice Motors home" }),
  ).toHaveAttribute("href", "/");
  expect(desktop.getByRole("link", { name: "Part exchange" })).toHaveAttribute(
    "href",
    "/enquire?type=part_exchange",
  );
  expect(desktop.getByRole("link", { name: "About us" })).toHaveAttribute(
    "href",
    "/#about",
  );
  expect(desktop.getByRole("link", { name: "Reviews" })).toHaveAttribute(
    "href",
    "/#reviews",
  );
  expect(desktop.getByRole("link", { name: "Contact us" })).toHaveAttribute(
    "href",
    "/contact",
  );
  fireEvent.click(desktop.getByRole("link", { name: "Contact us" }));
  expect(router.navigate).toHaveBeenLastCalledWith("/contact");
  fireEvent.click(desktop.getByRole("button", { name: "Services" }));
  const services = within(screen.getByRole("navigation", { name: "Services" }));
  expect(services.getByRole("link", { name: "Warranty" })).toHaveAttribute(
    "href",
    "/warranty",
  );
  expect(services.getByRole("link", { name: "Delivery" })).toHaveAttribute(
    "href",
    "/#delivery",
  );
  expect(
    services.getByRole("link", { name: settings.bookViewing.ctaLabel }),
  ).toHaveAttribute("href", "/enquire?type=viewing&vehicleId=car-1");
  fireEvent.click(services.getByRole("link", { name: "Warranty" }));
  expect(router.navigate).toHaveBeenLastCalledWith("/warranty");
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "Services" }),
    ).not.toBeInTheDocument(),
  );
});

it("keeps non-homepage mobile destinations and closes the drawer when navigating", async () => {
  const settings = config();
  settings.presentation = {
    ...settings.presentation,
    reviewsUrl: "https://reviews.example.test/dealer",
  };
  render(
    <MultiHomeHeader
      settings={settings}
      savedCount={1}
      testDriveHref="/enquire?type=viewing"
      isHomepage={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  const nav = within(
    screen.getByRole("navigation", { name: "Mobile navigation" }),
  );
  for (const [label, href] of [
    ["Part exchange", "/enquire?type=part_exchange"],
    ["Warranty", "/warranty"],
    ["Delivery", "/#delivery"],
    ["Reviews", "/#reviews"],
    ["About us", "/#about"],
    ["Contact us", "/contact"],
    ["Saved cars (1)", "/saved"],
  ])
    expect(nav.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
  fireEvent.click(nav.getByRole("link", { name: "Part exchange" }));
  expect(router.navigate).toHaveBeenLastCalledWith(
    "/enquire?type=part_exchange",
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("uses the informational part-exchange section when public enquiries are unavailable", async () => {
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
      isHomepage={false}
      enquiriesEnabled={false}
    />,
  );
  expect(screen.getByRole("link", { name: "Part exchange" })).toHaveAttribute(
    "href",
    "/#part-exchange",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  expect(
    within(
      screen.getByRole("navigation", { name: "Mobile navigation" }),
    ).getByRole("link", { name: "Part exchange" }),
  ).toHaveAttribute("href", "/#part-exchange");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(router.navigate).not.toHaveBeenCalled();
});

it("delegates non-homepage logo navigation to the unsaved-form guard without automatic routing", () => {
  const guard = vi.fn();
  const { rerender } = render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
      isHomepage={false}
      onLogoClick={guard}
    />,
  );
  fireEvent.click(
    screen.getByRole("link", { name: "Multi-Choice Motors home" }),
  );
  expect(guard).toHaveBeenCalledExactlyOnceWith();
  expect(router.navigate).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("link", { name: "Multi-Choice Motors home" }),
    { ctrlKey: true },
  );
  expect(guard).toHaveBeenCalledTimes(1);
  rerender(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
      isHomepage={false}
    />,
  );
  fireEvent.click(
    screen.getByRole("link", { name: "Multi-Choice Motors home" }),
  );
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith("/");
});

it("preserves homepage logo anchors and does not invoke a non-homepage guard there", () => {
  const guard = vi.fn();
  render(
    <MultiHomeHeader
      settings={config()}
      savedCount={0}
      testDriveHref="/enquire?type=viewing"
      onLogoClick={guard}
    />,
  );
  const logo = screen.getByRole("link", { name: "Multi-Choice Motors home" });
  expect(logo).toHaveAttribute("href", "#top");
  fireEvent.click(logo);
  expect(guard).not.toHaveBeenCalled();
  expect(router.navigate).not.toHaveBeenCalled();
});

it("uses route-aware footer links without adding contact details or bypassing enquiry gates", () => {
  const { rerender } = render(
    <MultiHomeFooter settings={config()} isHomepage={false} enquiriesEnabled />,
  );
  const links = within(
    screen.getByRole("navigation", { name: "Dealership links" }),
  );
  for (const [label, href] of [
    ["Part exchange", "/enquire?type=part_exchange"],
    ["Warranty", "/warranty"],
    ["Delivery", "/#delivery"],
    ["About us", "/#about"],
    ["Contact", "/contact"],
  ])
    expect(links.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
  expect(
    screen.getByRole("link", { name: "Multi-Choice Motors home" }),
  ).toHaveAttribute("href", "/");
  fireEvent.click(links.getByRole("link", { name: "Contact" }));
  expect(router.navigate).toHaveBeenLastCalledWith("/contact");
  expect(
    screen.queryByText(/Opening hours|020 4628 6488|Hayes/),
  ).not.toBeInTheDocument();
  rerender(
    <MultiHomeFooter
      settings={config()}
      isHomepage={false}
      enquiriesEnabled={false}
    />,
  );
  expect(links.getByRole("link", { name: "Part exchange" })).toHaveAttribute(
    "href",
    "/#part-exchange",
  );
  expect(
    links.queryByRole("link", { name: "Send an enquiry" }),
  ).not.toBeInTheDocument();
});
