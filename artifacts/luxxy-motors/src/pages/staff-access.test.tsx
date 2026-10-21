import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StaffSignIn, StaffSignUp } from "./staff-access";
import { staffAccessReturnUrl, staffReturnUrl } from "@/lib/staff-return-url";

vi.mock("@clerk/react", () => ({
  SignIn: ({ forceRedirectUrl, signUpForceRedirectUrl, signUpUrl }: Record<string, string>) =>
    <div data-testid="sign-in" data-return={forceRedirectUrl} data-other-return={signUpForceRedirectUrl} data-other-url={signUpUrl} />,
  SignUp: ({ forceRedirectUrl, signInForceRedirectUrl, signInUrl }: Record<string, string>) =>
    <div data-testid="sign-up" data-return={forceRedirectUrl} data-other-return={signInForceRedirectUrl} data-other-url={signInUrl} />,
}));

const recording = "/portal?section=inventory&vehicleId=car-one&recordVideo=1";
afterEach(() => window.history.replaceState({}, "", "/"));

it("retains the exact car recording page on the current production or local origin", () => {
  for (const origin of ["https://luxxymotors.uk", "http://127.0.0.1:4202"])
    expect(staffReturnUrl(`${origin}${recording}`, origin, "")).toBe(recording);
  expect(staffReturnUrl(recording, "https://dealer.example", "")).toBe(recording);
});

it.each([
  "https://other-dealer.example/portal?recordVideo=1",
  "//other-dealer.example/portal",
  "javascript:alert(1)",
  "data:text/html,test",
  "/stock",
  "/portal/fake",
  "/portal/../stock",
  "https://user:password@dealer.example/portal",
  "/\\other-dealer.example/portal",
  "/portal\n?recordVideo=1",
  "not a url",
])("rejects unsafe or unrelated staff return destination %s", value => {
  expect(staffReturnUrl(value, "https://dealer.example", "")).toBe("/portal");
});

it("uses the configured application base path", () => {
  expect(staffReturnUrl("/dealer/portal?recordVideo=1", "https://dealer.example", "/dealer"))
    .toBe("/dealer/portal?recordVideo=1");
  expect(staffReturnUrl("/portal?recordVideo=1", "https://dealer.example", "/dealer"))
    .toBe("/dealer/portal");
});

it.each(["redirect_url", "sign_in_force_redirect_url", "sign_up_force_redirect_url"])(
  "reads Clerk's %s return target", parameter => {
    expect(staffAccessReturnUrl(`?${parameter}=${encodeURIComponent(recording)}`)).toBe(recording);
  },
);

it.each([
  ["sign-in", StaffSignIn, "sign-up"],
  ["sign-up", StaffSignUp, "sign-in"],
] as const)("keeps the selected car through %s and account-flow switching", (id, Page, other) => {
  window.history.replaceState({}, "", `/${id}?redirect_url=${encodeURIComponent(recording)}`);
  render(<Page />);
  const form = screen.getByTestId(id);
  expect(form).toHaveAttribute("data-return", recording);
  expect(form).toHaveAttribute("data-other-return", recording);
  const nextUrl = new URL(form.getAttribute("data-other-url")!, window.location.origin);
  expect(nextUrl.pathname).toBe(`/${other}`);
  expect(nextUrl.searchParams.get("redirect_url")).toBe(recording);
});

it("defaults ordinary sign-in to the portal and rejects an external query destination", () => {
  expect(staffAccessReturnUrl("")).toBe("/portal");
  expect(staffAccessReturnUrl("?redirect_url=https%3A%2F%2Fother.example%2Fportal"))
    .toBe("/portal");
});
