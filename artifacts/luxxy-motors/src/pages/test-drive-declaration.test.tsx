import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ token: "a".repeat(64), fetch: vi.fn() }));
vi.mock("wouter", () => ({ useRoute: () => [true, { token: state.token }] }));
import TestDriveDeclarationPage from "./test-drive-declaration";
const declaration = {
  status: "pending",
  dealerName: "Example Motors",
  vehicle: { title: "2022 Ford Fiesta", registration: "AB22 CDE" },
  appointmentAt: "2099-10-20T10:00:00Z",
  durationMinutes: 30,
  statementVersion: "v1",
  statement:
    "I hold a current driving licence. The showroom must confirm insurance.",
  statementHash: "b".repeat(64),
  expiresAt: "2099-10-20T12:00:00Z",
  signedAt: null,
};
const reply = (data: unknown, ok = true, status = ok ? 200 : 410) => ({ ok, status, json: async () => data });
beforeEach(() => {
  state.token = "a".repeat(64);
  state.fetch.mockReset().mockResolvedValue(reply(declaration));
  vi.stubGlobal("fetch", state.fetch);
});
async function complete() {
  await screen.findByText("2022 Ford Fiesta");
  fireEvent.change(screen.getByRole("textbox", { name: "Your full name" }), {
    target: { value: "Alex Taylor" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}
it("shows the exact car and statement without signing, cookies or customer account requests", async () => {
  render(<TestDriveDeclarationPage />);
  expect(await screen.findByText("AB22 CDE")).toBeVisible();
  expect(screen.getByText(declaration.statement)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Sign declaration" }),
  ).toBeDisabled();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls[0]).toMatchObject([
    `/api/test-drive-declarations/${state.token}`,
    {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    },
  ]);
});
it("requires name and explicit acceptance and sends the frozen statement hash, then locks the form", async () => {
  state.fetch.mockImplementation(async (_path, options) =>
    options.method === "POST"
      ? reply({ status: "signed", signedAt: "2026-10-18T10:00:00Z" })
      : reply(declaration),
  );
  render(<TestDriveDeclarationPage />);
  await complete();
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  await screen.findByRole("heading", { name: "Declaration received" });
  const post = state.fetch.mock.calls.find((call) => call[1].method === "POST");
  expect(JSON.parse(post![1].body)).toMatchObject({
    signerName: "Alex Taylor",
    accepted: true,
    statementVersion: "v1",
    statementHash: declaration.statementHash,
  });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Sign declaration" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Print confirmation" }),
  ).toBeVisible();
});
it("retries identical signing bytes after a lost connection rather than creating another acceptance", async () => {
  let posts = 0;
  state.fetch.mockImplementation(async (_path, options) => {
    if (options.method !== "POST") return reply(declaration);
    if (++posts === 1) throw new Error("Connection lost. Please retry.");
    return reply({
      status: "signed",
      signedAt: "2026-10-18T10:00:00Z",
      replayed: true,
    });
  });
  render(<TestDriveDeclarationPage />);
  await complete();
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  await screen.findByRole("heading", { name: "Declaration received" });
  const postsSent = state.fetch.mock.calls.filter(
    (call) => call[1].method === "POST",
  );
  expect(postsSent).toHaveLength(2);
  expect(postsSent[0][1].body).toBe(postsSent[1][1].body);
});
it("does not request malformed links and explains an expired link without showing a signing form", async () => {
  state.token = "broken";
  const view = render(<TestDriveDeclarationPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("incomplete");
  expect(state.fetch).not.toHaveBeenCalled();
  state.token = "c".repeat(64);
  state.fetch.mockResolvedValue(
    reply(
      { error: "This link expired. Ask the showroom for a new link." },
      false,
    ),
  );
  view.rerender(<TestDriveDeclarationPage />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("expired"),
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("displays an existing signed confirmation without sending another acceptance", async () => {
  state.fetch.mockResolvedValue(
    reply({
      ...declaration,
      status: "signed",
      signedAt: "2026-10-18T10:00:00Z",
    }),
  );
  render(<TestDriveDeclarationPage />);
  await screen.findByRole("heading", { name: "Declaration received" });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.every((call) => call[1].method === "GET")).toBe(
    true,
  );
});
it('keeps the declaration readable when platform administration pauses new signatures', async () => {
  state.fetch.mockResolvedValue(reply({ ...declaration, signingEnabled: false }));
  render(<TestDriveDeclarationPage/>);
  expect(await screen.findByText(/The showroom has paused new signatures/)).toBeVisible();
  expect(screen.getByText(declaration.statement)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Sign declaration'})).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
});
it("ignores a previous link’s delayed signing result after navigating to a different link", async () => {
  let finish: (value: unknown) => void;
  state.fetch.mockImplementation(async (_path, options) =>
    options.method === "POST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : reply(declaration),
  );
  const view = render(<TestDriveDeclarationPage />);
  await complete();
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  state.token = "c".repeat(64);
  view.rerender(<TestDriveDeclarationPage />);
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  await act(async () =>
    finish!(reply({ status: "signed", signedAt: "2026-10-18T10:00:00Z" })),
  );
  expect(
    screen.getByRole("heading", { name: "A quick check before you drive" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Sign declaration" }),
  ).toBeDisabled();
});
it("refreshes a rejected submission and shows a signature already received from another device", async () => {
  let reads = 0;
  state.fetch.mockImplementation(async (_path, options) => options.method === "POST"
    ? reply({ error: "This declaration has already been signed." }, false, 409)
    : reply(++reads === 1 ? declaration : { ...declaration, status: "signed", signedAt: "2026-10-18T10:00:00Z" }));
  render(<TestDriveDeclarationPage />);
  await complete();
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  await screen.findByRole("heading", { name: "Declaration received" });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(reads).toBe(2);
});
it.each([409, 410])("removes the signing form when status %s reveals an unavailable link", async (status) => {
  let reads = 0;
  state.fetch.mockImplementation(async (_path, options) => options.method === "POST"
    ? reply({ error: "This link is no longer available." }, false, status)
    : ++reads === 1 ? reply(declaration) : reply({ error: "Ask the showroom for a replacement link." }, false, 410));
  render(<TestDriveDeclarationPage />);
  await complete();
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  await screen.findByText("Ask the showroom for a replacement link.");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign declaration" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
});
it("removes signing controls when a failed submission refreshes a paused policy", async () => {
  let reads = 0;
  state.fetch.mockImplementation(async (_path, options) => options.method === "POST"
    ? reply({ error: "New signatures are paused." }, false, 403)
    : reply(++reads === 1 ? declaration : { ...declaration, signingEnabled: false }));
  render(<TestDriveDeclarationPage />);
  await complete();
  fireEvent.click(screen.getByRole("button", { name: "Sign declaration" }));
  await screen.findByText(/The showroom has paused new signatures/);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
