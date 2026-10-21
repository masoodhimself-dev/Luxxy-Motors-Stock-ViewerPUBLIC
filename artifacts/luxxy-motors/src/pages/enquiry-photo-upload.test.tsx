import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
const state = vi.hoisted(() => ({ fetch: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/service-book-photo", () => ({ prepareServicePhoto: (...args: unknown[]) => state.prepare(...args) }));
import EnquiryPhotoUpload from "./enquiry-photo-upload";
const session = { title: "Toyota Yaris", customerName: "Alex", remaining: 2, expiresAt: "2030-01-01T10:30:00Z", completed: false };
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => {
  window.history.replaceState(null, "", "/enquiry-photo-upload#secret-upload-token");
  state.fetch.mockReset().mockResolvedValue(reply(session));
  vi.stubGlobal("fetch", state.fetch);
  state.prepare.mockReset().mockResolvedValue({ base64: "compressed", preview: "data:image/jpeg;base64,compressed", bytes: 12000 });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("scrubs the capability from the address bar and requires explicit upload after photo review", async () => {
  render(<EnquiryPhotoUpload />);
  await screen.findByLabelText("Choose enquiry photos");
  expect(window.location.hash).toBe("");
  expect(state.fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", headers: { "x-enquiry-upload-token": "secret-upload-token" } });
  fireEvent.change(screen.getByLabelText("Take an enquiry photo"), { target: { files: [new File(["photo"], "location.jpg", { type: "image/jpeg" })] } });
  expect(await screen.findByAltText("Enquiry photo 1 for review")).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  state.fetch.mockResolvedValueOnce(reply({ uploaded: ["one"] }));
  fireEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));
  expect(await screen.findByRole("heading", { name: "Photos are ready" })).toBeVisible();
  expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toMatchObject({ photos: ["compressed"], requestId: expect.any(String) });
  expect(state.fetch.mock.calls[1][1].body).not.toContain("location.jpg");
  expect(screen.getByText("Nothing has been sent to the customer. You can close this page.")).toBeVisible();
});
it("keeps selected photos and retries the same request after a disconnected response", async () => {
  render(<EnquiryPhotoUpload />);
  fireEvent.change(await screen.findByLabelText("Choose enquiry photos"), { target: { files: [new File(["x"], "x.jpg", { type: "image/jpeg" })] } });
  await screen.findByAltText("Enquiry photo 1 for review");
  state.fetch.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByAltText("Enquiry photo 1 for review")).toBeVisible();
  state.fetch.mockResolvedValueOnce(reply({ uploaded: ["one"], replayed: true }));
  fireEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));
  await screen.findByRole("heading", { name: "Photos are ready" });
  expect(state.fetch.mock.calls[2][1].body).toBe(state.fetch.mock.calls[1][1].body);
});
it("does not prepare or upload more than the remaining two-photo allowance", async () => {
  render(<EnquiryPhotoUpload />);
  fireEvent.change(await screen.findByLabelText("Choose enquiry photos"), { target: { files: [new File(["a"], "a.jpg"), new File(["b"], "b.jpg"), new File(["c"], "c.jpg")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("up to 2 photos");
  expect(state.prepare).not.toHaveBeenCalled();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("requires a fresh QR when no capability is present", async () => {
  window.history.replaceState(null, "", "/enquiry-photo-upload");
  render(<EnquiryPhotoUpload />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Scan a fresh");
  expect(state.fetch).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Take an enquiry photo")).not.toBeInTheDocument();
});
it("disables taking or choosing photos when the link has expired", async () => {
  state.fetch.mockResolvedValue(reply({ ...session, expiresAt: "2020-01-01T00:00:00Z" }));
  render(<EnquiryPhotoUpload />);
  expect(await screen.findByLabelText("Choose enquiry photos")).toBeDisabled();
  expect(screen.getByLabelText("Take an enquiry photo")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("link has expired");
  expect(screen.queryByRole("button", { name: "Upload 1 photo" })).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});

it("keeps reviewed photos when a previously valid upload link expires", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  state.fetch.mockResolvedValue(reply({ ...session, expiresAt: new Date(now + 6000).toISOString() }));
  render(<EnquiryPhotoUpload />);
  fireEvent.change(await screen.findByLabelText("Choose enquiry photos"), { target: { files: [new File(["x"], "x.jpg", { type: "image/jpeg" })] } });
  await screen.findByAltText("Enquiry photo 1 for review");
  now += 7000;
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByAltText("Enquiry photo 1 for review")).toBeVisible();
  expect(screen.getByRole("button", { name: "Upload 1 photo" })).toBeDisabled();
  expect(screen.getByLabelText("Take an enquiry photo")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("upload link has expired");
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
