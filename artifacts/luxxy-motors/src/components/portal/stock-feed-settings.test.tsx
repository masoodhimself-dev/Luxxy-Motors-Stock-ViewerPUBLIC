import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StockFeedSettings } from "./stock-feed-settings";
const state = vi.hoisted(() => ({enabled: [] as boolean[], refetch: vi.fn(), feed: { source: "Official Cazoo CSV", receivedAt: "2026-10-29T19:19:00Z", state: "current", scheduled: true } }));
vi.mock("./staff-cars-query", () => ({ useStaffCars: (enabled: boolean) => { state.enabled.push(enabled); return {data: {feed: state.feed}, refetch: state.refetch}; } }));
it("keeps connection details collapsed, reads only on opening and refreshes saved status", () => {
 render(<StockFeedSettings/>);
 expect(state.enabled.at(-1)).toBe(false);
 expect(screen.queryByText("Official Cazoo CSV")).not.toBeInTheDocument();
 const details = screen.getByText("Stock connection").closest("details")!;
 details.open = true; fireEvent(details, new Event("toggle"));
 expect(state.enabled.at(-1)).toBe(true);
 expect(screen.getByText("Official Cazoo CSV")).toBeVisible();
 fireEvent.click(screen.getByRole("button", {name: "Refresh connection status"}));
 expect(state.refetch).toHaveBeenCalledTimes(1);
});
