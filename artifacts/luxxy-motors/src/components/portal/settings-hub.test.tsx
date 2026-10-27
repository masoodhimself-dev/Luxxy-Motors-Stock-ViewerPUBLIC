import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@/components/dealer-settings-panel", () => ({
  DealerSettingsPanel: ({ group }: { group: string }) => (
    <p>Details editor {group}</p>
  ),
}));
vi.mock("@/components/sales-paperwork-settings", () => ({
  SalesPaperworkSettings: () => <p>Invoice terms editor</p>,
}));
vi.mock("@/components/email-templates-settings", () => ({
  EmailTemplatesSettings: () => {
    const [value, setValue] = useState("");
    return (
      <div data-settings-dirty={!!value}>
        <label>
          Message wording
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      </div>
    );
  },
}));
import { DealerSettingsHub } from "./dealer-administration";
const clients: QueryClient[] = [];
function show(search = "") {
  window.history.replaceState({}, "", `/portal?section=settings${search}`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        permissions: ["settings.publish", "team.manage"],
        user: {},
        role: "owner",
      }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DealerSettingsHub />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});
it("offers six core owner settings areas without optional modules", async () => {
  show();
  await screen.findByText("Details editor dealership");
  expect(
    within(screen.getByRole("tablist", { name: "Settings categories" }))
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual([
    "Business",
    "Brand",
    "Bookings",
    "Invoices & terms",
    "Messages",
    "Team",
  ]);
  expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
});
it("opens a direct booking link and its correctly labelled panel", async () => {
  show("&settingsTab=bookings");
  await screen.findByText("Details editor bookings");
  expect(screen.getByRole("tabpanel", { name: "Bookings" })).toBeVisible();
});
it("protects unsaved wording when switching owner settings areas", async () => {
  show("&settingsTab=emails");
  await screen.findByLabelText("Message wording");
  fireEvent.change(screen.getByLabelText("Message wording"), {
    target: { value: "Keep this wording" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("tab", { name: "Brand" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Message wording")).toHaveValue(
    "Keep this wording",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("tab", { name: "Brand" }));
  expect(await screen.findByText("Details editor website")).toBeVisible();
});
