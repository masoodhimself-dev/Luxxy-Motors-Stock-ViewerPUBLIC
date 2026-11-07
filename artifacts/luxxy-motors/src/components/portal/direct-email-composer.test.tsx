import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DirectEmailComposer } from "./direct-email-composer";

const features = vi.hoisted(() => ({ email: true }));
vi.mock("@/lib/dealer-features", () => ({
  useDealerFeatures: () => ({ enabled: () => features.email, isLoading: false }),
}));

const previewHash = "a".repeat(64);
const reviewResponse = () => Response.json({
  email: "alex@example.test", subject: "Your paperwork", html: "<p>Your paperwork is ready.</p>",
  text: "Your paperwork is ready.", previewHash,
});

beforeEach(() => { features.email = true; });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function compose() {
  render(<DirectEmailComposer onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: "ALEX@example.test" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Your paperwork" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Your paperwork is ready." } });
}

it("reviews a standalone email and reuses the same request if sending is unconfirmed", async () => {
  const sends: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options: RequestInit) => {
    if (path.endsWith("/preview")) return reviewResponse();
    sends.push(String(options.body));
    if (sends.length === 1) throw new TypeError("Connection interrupted");
    return Response.json({ providerId: "example-email-id" });
  }));
  compose();
  expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  expect(await screen.findByTitle("Customer email design preview")).toHaveAttribute("sandbox", "");
  expect(sends).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Send email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email sending is unconfirmed");
  expect(screen.queryByRole("button", { name: "Edit email" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry same email" }));
  expect(await screen.findByRole("heading", { name: "Email sent" })).toBeVisible();
  expect(sends).toHaveLength(2);
  expect(sends[0]).toEqual(sends[1]);
  expect(JSON.parse(sends[0]!)).toMatchObject({ email: "alex@example.test", previewHash, body: "Your paperwork is ready." });
});

it("keeps the email preview usable when sending is switched off", async () => {
  features.email = false;
  const fetcher = vi.fn(async () => reviewResponse());
  vi.stubGlobal("fetch", fetcher);
  compose();
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  expect(await screen.findByRole("status", { name: "" })).toBeInTheDocument();
  expect(screen.getByText("Email sending is unavailable for this dealership.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledOnce();
});
