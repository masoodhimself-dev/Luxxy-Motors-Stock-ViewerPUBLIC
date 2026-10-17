import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  CustomerEmailPreview,
  emailPreviewDocument,
} from "./customer-email-preview";

const html =
  '<!doctype html><html><head><style>@media(max-width:600px){.email-shell{width:100%!important}}</style></head><body><table class="email-shell" style="font-family:Arial;background:#fff"><tr><td><img src="https://dealer.example/logo.png" alt="Test Motors"><h1>Your car details</h1><p>Hello Alex, here is your Ford Fiesta.</p><a style="color:#245779" href="https://dealer.example/vehicle/one">View this car</a></td></tr></table></body></html>';

it("previews the server-rendered design in an isolated frame and retains its branding", () => {
  render(
    <CustomerEmailPreview
      html={html}
      text="Hello Alex, here is your Ford Fiesta."
    />,
  );
  const frame = screen.getByTitle("Customer email design preview");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  const preview = new DOMParser().parseFromString(
    frame.getAttribute("srcdoc")!,
    "text/html",
  );
  expect(preview.querySelector("h1")?.textContent).toBe("Your car details");
  expect(preview.querySelector("img")?.getAttribute("src")).toBe(
    "https://dealer.example/logo.png",
  );
  expect(preview.querySelector("table")?.getAttribute("style")).toContain(
    "font-family:Arial",
  );
  expect(preview.querySelector("style")?.textContent).toContain(
    "@media(max-width:600px)",
  );
  expect(preview.querySelector("a")?.getAttribute("href")).toBeNull();
  expect(preview.querySelector("a")?.getAttribute("style")).toBe(
    "color:#245779",
  );
  expect(screen.getByRole("button", { name: "Design" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("blocks preview scripts, redirects, linked navigation and form submission without changing the sent email", () => {
  const source =
    '<html><head><base href="https://other.example/"><meta http-equiv="refresh" content="0;url=https://other.example"><link rel="prefetch" href="https://other.example"></head><body><script>alert(1)</script><iframe src="https://other.example"></iframe><object data="https://other.example"></object><a href="mailto:customer@example.test" target="_blank" ping="https://other.example">Email customer</a><form action="https://other.example"><button formaction="https://other.example">Send</button><input name="value"></form></body></html>';
  const preview = new DOMParser().parseFromString(
    emailPreviewDocument(source),
    "text/html",
  );
  expect(
    preview.querySelector(
      "script,iframe,object,base,link,meta[http-equiv=refresh]",
    ),
  ).toBeNull();
  expect(
    preview
      .querySelector("meta[http-equiv=Content-Security-Policy]")
      ?.getAttribute("content"),
  ).toContain("script-src 'none'");
  expect(
    preview
      .querySelector("meta[http-equiv=Content-Security-Policy]")
      ?.getAttribute("content"),
  ).toContain("form-action 'none'");
  expect(preview.querySelector("a")?.getAttribute("href")).toBeNull();
  expect(preview.querySelector("a")?.hasAttribute("inert")).toBe(true);
  expect(preview.querySelector("form")?.getAttribute("action")).toBeNull();
  expect(preview.querySelector("button")?.hasAttribute("disabled")).toBe(true);
  expect(
    preview.querySelector("button")?.getAttribute("formaction"),
  ).toBeNull();
  expect(source).toContain('href="mailto:customer@example.test"');
  expect(
    preview
      .querySelector('meta[name="format-detection"]')
      ?.getAttribute("content"),
  ).toContain("telephone=no");
});

it("switches between design and full plain text and offers a narrow phone preview", () => {
  render(
    <CustomerEmailPreview
      html={html}
      text={"Hello Alex,\n\nYour Ford Fiesta details.\n\nTest Motors"}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Phone preview" }));
  expect(screen.getByRole("button", { name: "Phone preview" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Plain text" }));
  expect(
    screen.queryByTitle("Customer email design preview"),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Your Ford Fiesta details/)).toHaveTextContent(
    "Test Motors",
  );
  fireEvent.click(screen.getByRole("button", { name: "Design" }));
  expect(
    screen.getByTitle("Customer email design preview"),
  ).toBeInTheDocument();
});

it("keeps the plain-text review usable when a previous server version has no HTML field", () => {
  render(<CustomerEmailPreview text="Existing email preview" />);
  expect(screen.getByRole("button", { name: "Design" })).toBeDisabled();
  expect(screen.getByText("Existing email preview")).toBeInTheDocument();
  expect(
    screen.getByText(/Reopen the email to load the latest design preview/),
  ).toBeInTheDocument();
});
