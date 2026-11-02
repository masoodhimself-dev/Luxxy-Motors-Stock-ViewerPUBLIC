import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryObserverOptions } from "@tanstack/react-query";
import type { StaffMotCheckStatus } from "@workspace/vehicle-meta";
import { CarsMotCheckStatus, carsMotChecksKey, motChecksAreActive, useCarsMotChecks } from "./cars-mot-checks";

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));

const status = (extra: Partial<StaffMotCheckStatus> = {}): StaffMotCheckStatus => ({
  configured: true,
  automatic: true,
  current: { total: 3, checked: 1, needsCheck: 2, pending: 0, failed: 0, missingRegistration: 0 },
  run: null,
  ...extra,
});
const running = () => status({ run: { id: "run-one", status: "running", total: 3, checked: 1, failed: 0, skipped: 0, pending: 2, startedAt: "2026-11-01T10:00:00Z", finishedAt: null } });

function Tools({ canManage = true }: { canManage?: boolean }) {
  const checks = useCarsMotChecks(canManage);
  if (!canManage) return null;
  return <><button disabled={checks.disabled} onClick={() => void checks.start()}>{checks.active || checks.starting ? "Checking MOTs…" : "Check all MOTs"}</button><CarsMotCheckStatus checks={checks} /></>;
}
function mount(canManage = true, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return { client, ...render(<QueryClientProvider client={client}><Tools canManage={canManage} /></QueryClientProvider>) };
}
beforeEach(() => { state.fetch.mockReset(); state.fetch.mockResolvedValue(status()); });

it("reads saved status without requesting a provider check on page open", async () => {
  mount();
  expect(await screen.findByText("1 of 3 current cars checked")).toBeVisible();
  expect(screen.getByText(/New arrivals are checked automatically/)).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch).toHaveBeenCalledWith("/api/staff/vehicles/mot-checks", { signal: expect.any(AbortSignal) });
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeEnabled();
  expect(motChecksAreActive(status())).toBe(false);
});

it("starts a single check for the server-selected current cars, disables duplicate clicks and refreshes MOT badges", async () => {
  let finish!: (value: StaffMotCheckStatus) => void;
  state.fetch.mockImplementation((_url, options) => options?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(status()));
  const { client } = mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await screen.findByText("1 of 3 current cars checked");
  const button = screen.getByRole("button", { name: "Check all MOTs" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(screen.getByRole("button", { name: "Checking MOTs…" })).toBeDisabled();
  expect(state.fetch.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(1);
  expect(state.fetch).toHaveBeenLastCalledWith("/api/staff/vehicles/mot-checks", { method: "POST", responseType: "json", signal: expect.any(AbortSignal) });
  await act(async () => finish(running()));
  expect(await screen.findByText("Checking MOTs · 1 of 3 cars processed")).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "MOT check progress" })).toHaveAttribute("value", "1");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["staff-cars"] });
  await act(async () => { client.setQueryData(carsMotChecksKey, status({ current: { ...status().current, checked: 3, needsCheck: 0 }, run: { ...running().run!, status: "completed", checked: 3, pending: 0, finishedAt: "2026-11-01T10:01:00Z" } })); });
  expect(await screen.findByText("3 of 3 current cars checked")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeEnabled();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("retains a clear retry action when the start request fails", async () => {
  state.fetch.mockImplementation((_url, options) => options?.method === "POST" ? Promise.reject(new Error("offline")) : Promise.resolve(status()));
  mount();
  await screen.findByText("1 of 3 current cars checked");
  fireEvent.click(screen.getByRole("button", { name: "Check all MOTs" }));
  expect(await screen.findByText("MOT checks could not be started. Please try again.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeEnabled();
  state.fetch.mockResolvedValue(running());
  fireEvent.click(screen.getByRole("button", { name: "Check all MOTs" }));
  expect(await screen.findByText("Checking MOTs · 1 of 3 cars processed")).toBeVisible();
});

it("does not claim successful checks when status fails and can retry the saved status", async () => {
  state.fetch.mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText(/MOT check progress is unavailable/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeDisabled();
  state.fetch.mockResolvedValue(status());
  fireEvent.click(screen.getByRole("button", { name: "Retry MOT status" }));
  expect(await screen.findByText("1 of 3 current cars checked")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeEnabled();
});

it("does not expose cached status or request checks without the existing permission", () => {
  const client = new QueryClient();
  client.setQueryData(carsMotChecksKey, running());
  mount(false, client);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("disables checks when the connection is not configured or there are no current cars", async () => {
  state.fetch.mockResolvedValue(status({ configured: false }));
  const view = mount();
  expect(await screen.findByText(/Check the MOT connection in Settings/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeDisabled();
  expect(screen.queryByText("1 of 3 current cars checked")).not.toBeInTheDocument();
  view.unmount();
  state.fetch.mockResolvedValue(status({ current: { total: 0, checked: 0, needsCheck: 0, pending: 0, failed: 0, missingRegistration: 0 } }));
  mount();
  expect(await screen.findByText("No current cars to check.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Check all MOTs" })).toBeDisabled();
});

it("distinguishes failures and unusable registrations and recognises automatic arrival work", async () => {
  state.fetch.mockResolvedValue(status({ current: { total: 4, checked: 2, needsCheck: 0, pending: 0, failed: 1, missingRegistration: 1 } }));
  mount();
  expect(await screen.findByText("2 of 4 current cars checked · 1 could not be checked · 1 without a usable registration")).toBeVisible();
  expect(motChecksAreActive(status({ current: { ...status().current, pending: 1 } }))).toBe(true);
  expect(motChecksAreActive(running())).toBe(true);
});

it("polls progress only while a manual run or automatic arrival check is active", async () => {
  const { client } = mount();
  await screen.findByText("1 of 3 current cars checked");
  const interval = (client.getQueryCache().find({ queryKey: carsMotChecksKey })!.options as QueryObserverOptions<StaffMotCheckStatus>).refetchInterval as (query: any) => number | false;
  expect(interval({ state: { data: status() } })).toBe(false);
  expect(interval({ state: { data: running() } })).toBe(3_000);
  expect(interval({ state: { data: status({ current: { ...status().current, pending: 1 } }) } })).toBe(3_000);
});

it("aborts a start request on unmount and cannot repopulate a cleared staff cache with its late response", async () => {
  let finish!: (value: StaffMotCheckStatus) => void;
  state.fetch.mockImplementation((_url, options) => options?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(status()));
  const view = mount();
  await screen.findByText("1 of 3 current cars checked");
  fireEvent.click(screen.getByRole("button", { name: "Check all MOTs" }));
  const signal = state.fetch.mock.calls.find(([, opts]) => opts?.method === "POST")![1].signal as AbortSignal;
  view.unmount();
  view.client.clear();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(running()));
  expect(view.client.getQueryData(carsMotChecksKey)).toBeUndefined();
});

it("labels local preview checks explicitly", async () => {
  state.fetch.mockResolvedValue({ ...running(), preview: true });
  mount();
  expect(await screen.findByText("Checking MOTs · 1 of 3 cars processed · Preview check")).toBeVisible();
});
