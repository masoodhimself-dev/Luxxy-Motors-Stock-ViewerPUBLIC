import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LetterComposer } from "./letter-composer";

const features = vi.hoisted(() => ({ email: true }));
vi.mock("@/lib/dealer-features", () => ({
  useDealerFeatures: () => ({ enabled: () => features.email, isLoading: false }),
}));

const hash = "a".repeat(64);
const previewUrl = "blob:letter-pdf";
const previewImage = "blob:letter-image";
const previewResponse = () => Response.json({
  pdfBase64: "JVBERi0xLjQK",
  previewSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"/>',
  previewHash: hash,
});

beforeEach(() => {
  features.email = true;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = (blob: Blob) => blob.type === "application/pdf" ? previewUrl : previewImage;
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function draftLetter() {
  render(<LetterComposer canEmail recipient={{ name: "Alex Walker", email: "ALEX@example.com" }} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Your vehicle paperwork" } });
  fireEvent.change(screen.getByLabelText("Letter", { exact: true }), { target: { value: "Dear Alex,\n\nYour paperwork is ready." } });
}

it("reviews the actual A4 PDF first and retries an unconfirmed email with the identical request", async () => {
  const sends: string[] = [];
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith("/preview")) return previewResponse();
    sends.push(String(init.body));
    if (sends.length === 1) throw new TypeError("Connection interrupted");
    return Response.json({ providerId: "example-letter-id" });
  });
  vi.stubGlobal("fetch", fetcher);
  draftLetter();
  expect(screen.queryByRole("button", { name: "Email letter" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview A4" }));

  expect(await screen.findByRole("link", { name: "Open / print PDF" })).toHaveAttribute("href", previewUrl);
  expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", previewUrl);
  expect(screen.getAllByAltText("First page of the A4 letter")[0]).toHaveAttribute("src", previewImage);
  expect(sends).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Email letter" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Email sending is unconfirmed");
  expect(screen.getByLabelText("Recipient email")).toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: "Back to letter" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry same email" }));

  expect(await screen.findByRole("heading", { name: "Letter emailed" })).toBeVisible();
  expect(sends).toHaveLength(2);
  expect(sends[0]).toEqual(sends[1]);
  expect(JSON.parse(sends[0]!)).toMatchObject({ email: "alex@example.com", previewHash: hash });
});

it("keeps printing available when dealership email sending is off", async () => {
  features.email = false;
  const fetcher = vi.fn(async () => previewResponse());
  vi.stubGlobal("fetch", fetcher);
  draftLetter();
  fireEvent.click(screen.getByRole("button", { name: "Preview A4" }));
  expect(await screen.findByRole("link", { name: "Open / print PDF" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Email letter" })).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
});
