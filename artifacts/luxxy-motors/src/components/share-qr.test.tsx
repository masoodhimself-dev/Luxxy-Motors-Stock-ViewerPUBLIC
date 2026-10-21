import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareQr } from "./share-qr";
const api = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => api(...args),
}));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr" data-value={value} />
  ),
}));
beforeEach(() => {
  api.mockReset();
});
it("public links create a local QR with no request or automatic send", async () => {
  render(<ShareQr url="/vehicle/car?video=1#walkaround" />);
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  expect(await screen.findByTestId("qr")).toHaveAttribute(
    "data-value",
    `${window.location.origin}/vehicle/car?video=1#walkaround`,
  );
  expect(api).not.toHaveBeenCalled();
});
it("private document QR is generated only after click and can be revoked", async () => {
  api
    .mockResolvedValueOnce({
      id: "grant",
      url: `${window.location.origin}/phone-share#${"a".repeat(64)}`,
      expiresAt: "2026-11-01T12:00:00Z",
    })
    .mockResolvedValueOnce({ revoked: true });
  render(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "doc" }}
    />,
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  expect(await screen.findByTestId("qr")).toBeVisible();
  const body = JSON.parse(api.mock.calls[0][1].body);
  expect(body.source).toEqual({
    kind: "document",
    saleId: "sale",
    documentId: "doc",
  });
  expect(body.token).toMatch(/^[a-f0-9]{64}$/);
  fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
  await screen.findByText("Link revoked. It can no longer be opened.");
  expect(api.mock.calls[1][0]).toBe("/api/staff/phone-shares/grant/revoke");
});
it("an uncertain request retries the same token and request id", async () => {
  api
    .mockRejectedValueOnce(new Error("Temporary network failure"))
    .mockResolvedValueOnce({
      id: "grant",
      url: `${window.location.origin}/phone-share#${"b".repeat(64)}`,
      expiresAt: "2026-11-01T12:00:00Z",
    });
  render(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "doc" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Create sharing link" }));
  await screen.findByTestId("qr");
  expect(api.mock.calls[0][1].body).toBe(api.mock.calls[1][1].body);
});
it("rejects executable public URLs", async () => {
  render(<ShareQr url="javascript:alert(1)" />);
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not available");
  expect(screen.queryByTestId("qr")).toBeNull();
});
it("changing the reviewed document clears the old sharing capability", async () => {
  api.mockResolvedValueOnce({
    id: "grant",
    url: "/phone-share#old",
    expiresAt: "2026-11-01T12:00:00Z",
  });
  const view = render(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "first" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  await screen.findByTestId("qr");
  view.rerender(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "second" }}
    />,
  );
  await waitFor(() => expect(screen.queryByTestId("qr")).toBeNull());
});
