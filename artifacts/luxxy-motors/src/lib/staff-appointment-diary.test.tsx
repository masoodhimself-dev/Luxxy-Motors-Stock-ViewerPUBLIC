import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { customFetch, getGetEnquiriesQueryKey } from "@workspace/api-client-react";
import { useStaffAppointmentDiary } from "./staff-appointment-diary";

vi.mock("@workspace/api-client-react", async importOriginal => ({ ...await importOriginal<object>(), customFetch: vi.fn() }));
beforeEach(() => vi.mocked(customFetch).mockReset());
function setup(date: string, enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ date, enabled }) => useStaffAppointmentDiary(date, enabled), { initialProps: { date, enabled }, wrapper }) };
}
const empty = (date: string) => ({ date, timezone: "Europe/London", appointments: [] });

it("loads the selected day's appointment fields without fetching the full enquiry archive", async () => {
  vi.mocked(customFetch).mockResolvedValue(empty("2026-10-25"));
  const view = setup("2026-10-25");
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  expect(customFetch).toHaveBeenCalledExactlyOnceWith("/api/staff/enquiries/appointments?date=2026-10-25", expect.objectContaining({ signal: expect.any(AbortSignal), responseType: "json" }));
  expect(view.result.current.data?.date).toBe("2026-10-25");
});

it("does not fetch without a date or while staff use the available-slots mode", async () => {
  const view = setup("");
  expect(customFetch).not.toHaveBeenCalled();
  view.rerender({ date: "2026-10-25", enabled: false });
  expect(customFetch).not.toHaveBeenCalled();
  vi.mocked(customFetch).mockResolvedValue(empty("2026-10-25"));
  view.rerender({ date: "2026-10-25", enabled: true });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  expect(customFetch).toHaveBeenCalledTimes(1);
});

it("clears another day's cached diary while checking a newly chosen date", async () => {
  let finish: (value: unknown) => void = () => {};
  vi.mocked(customFetch).mockResolvedValueOnce(empty("2026-10-25")).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = setup("2026-10-25");
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  view.rerender({ date: "2026-10-26", enabled: true });
  expect(view.result.current.data).toBeUndefined();
  expect(view.result.current.isPending).toBe(true);
  await act(async () => finish(empty("2026-10-26")));
  await waitFor(() => expect(view.result.current.data?.date).toBe("2026-10-26"));
});

it("refreshes the bounded diary when an appointment mutation invalidates enquiries", async () => {
  vi.mocked(customFetch).mockResolvedValue(empty("2026-10-25"));
  const view = setup("2026-10-25");
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  await act(async () => view.client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }));
  expect(customFetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(customFetch).mock.calls.every(([url]) => String(url).startsWith("/api/staff/enquiries/appointments?date="))).toBe(true);
});
