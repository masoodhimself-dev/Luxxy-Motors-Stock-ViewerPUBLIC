import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ fetch: vi.fn(), prepare: vi.fn(), refresh: vi.fn(), change: vi.fn(), busy: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock("@/lib/service-book-photo", () => ({ prepareServicePhoto: (...args: unknown[]) => state.prepare(...args) }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: ({ value }: { value: string }) => <svg aria-label="Upload QR" data-value={value} /> }));
import { EnquiryMediaAttachments } from "./enquiry-media-attachments";
function Wrapper({ photos = [] }: { photos?: Array<{ id: string; byteSize: number; url: string }> }) {
  const [selection, setSelection] = useState({ customPhotoIds: [] as string[], vehiclePhotoIndices: [] as number[], includeVideo: false });
  return <EnquiryMediaAttachments enquiryId="enquiry-one" photos={photos} vehiclePhotos={Array.from({ length: 5 }, (_, index) => ({ index, url: `https://example.test/${index}.jpg` }))} videoAvailable selection={selection} disabled={false} onChange={value => { state.change(value); setSelection(current => ({ ...current, ...value })); }} onRefresh={state.refresh} onBusyChange={state.busy} />;
}
beforeEach(() => {
  state.fetch.mockReset(); state.change.mockClear(); state.busy.mockClear(); state.refresh.mockReset().mockResolvedValue(undefined);
  state.prepare.mockReset().mockResolvedValue({ base64: "compressed-jpeg", bytes: 18000, preview: "data:image/jpeg;base64,compressed-jpeg" });
});
it("limits selected public car photos to four and allows the published video without any send", () => {
  render(<Wrapper />);
  fireEvent.click(screen.getByText(/Car photos/).closest("summary")!);
  for (let index = 1; index <= 4; index++) fireEvent.click(screen.getByRole("checkbox", { name: `Include car photo ${index}` }));
  expect(screen.getByRole("checkbox", { name: "Include car photo 5" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Include the published car video/ }));
  expect(state.change).toHaveBeenLastCalledWith({ includeVideo: true });
  expect(state.fetch).not.toHaveBeenCalled();
});
it("compresses custom photos, selects their saved IDs and leaves sending to staff", async () => {
  state.fetch.mockResolvedValue({ uploaded: ["photo-one"], replayed: false });
  render(<Wrapper />);
  const file = new File(["source pixels"], "private-location.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Choose custom enquiry photos"), { target: { files: [file] } });
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  expect(state.prepare).toHaveBeenCalledWith(file, 0, [file]);
  const [url, options] = state.fetch.mock.calls[0];
  expect(url).toBe("/api/staff/enquiries/enquiry-one/photos");
  expect(JSON.parse(options.body)).toMatchObject({ photos: ["compressed-jpeg"], requestId: expect.any(String) });
  expect(options.body).not.toContain("private-location.jpg");
  expect(state.change).toHaveBeenCalledWith({ customPhotoIds: ["photo-one"] });
  expect(state.fetch.mock.calls.every(([path]) => !String(path).endsWith("/email"))).toBe(true);
});
it("refuses a third custom photo before compression or network activity", async () => {
  state.fetch.mockResolvedValue(new Blob());
  render(<Wrapper photos={[{ id: "existing", byteSize: 100, url: "/photos/existing" }]} />);
  const before = state.fetch.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Choose custom enquiry photos"), { target: { files: [new File(["a"], "a.jpg"), new File(["b"], "b.jpg")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("1 more photo");
  expect(state.prepare).not.toHaveBeenCalled();
  expect(state.fetch).toHaveBeenCalledTimes(before);
});
it("retries a lost upload response with the identical compressed payload and request ID", async () => {
  state.fetch.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce({ uploaded: ["photo-one"], replayed: true });
  render(<Wrapper />);
  fireEvent.change(screen.getByLabelText("Choose custom enquiry photos"), { target: { files: [new File(["x"], "x.jpg", { type: "image/jpeg" })] } });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry same photo upload" }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  expect(state.fetch.mock.calls[1][1].body).toBe(state.fetch.mock.calls[0][1].body);
  expect(state.prepare).toHaveBeenCalledTimes(1);
});
it("creates the phone QR only on request and can revoke its upload capability", async () => {
  state.fetch.mockResolvedValueOnce({ id: "session-one", url: "/enquiry-photo-upload#private-token", expiresAt: "2030-01-01T10:30:00Z" }).mockResolvedValueOnce({ ok: true });
  render(<Wrapper />);
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add photos from phone" }));
  expect(await screen.findByLabelText("Upload QR")).toHaveAttribute("data-value", `${window.location.origin}/enquiry-photo-upload#private-token`);
  expect(screen.getByText(/It does not send anything to the customer/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Disable upload link" }));
  await waitFor(() => expect(screen.queryByLabelText("Upload QR")).not.toBeInTheDocument());
  expect(state.fetch.mock.calls[1]).toEqual(["/api/staff/enquiries/enquiry-one/photo-upload-session/session-one", { method: "DELETE" }]);
});

it("does not display a scannable QR or open link for an expired upload session", async () => {
  state.fetch.mockResolvedValue({ id: "expired", url: "/enquiry-photo-upload#expired", expiresAt: "2020-01-01T10:30:00Z" });
  render(<Wrapper />);
  fireEvent.click(screen.getByRole("button", { name: "Add photos from phone" }));
  expect(await screen.findByText("Upload QR expired")).toBeVisible();
  expect(screen.queryByLabelText("Upload QR")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open upload page" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Create a new upload QR");
});
