vi.mock("./workspace-tools", () => ({ OwnerSetup: () => null, OwnerOperationsReport: () => null }));
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
function show(search = "", reservations?: typeof fetch) {
  window.history.replaceState({}, "", `/portal?section=settings${search}`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (reservations && String(url) === "/api/staff/reservations/settings") {
        return reservations(url, init);
      }
      return Response.json({
        permissions: ["settings.publish", "team.manage"],
        user: {},
        role: "owner",
      });
    }),
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
it("saves the online reservation switch in Brand settings", async () => {
  let enabled = true;
  const reservations = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "PUT") enabled = JSON.parse(String(init.body)).enabled;
    return Response.json({ enabled, paymentReady: true, supported: true });
  });
  show("&settingsTab=website", reservations);
  const setting = within(await screen.findByRole("region", { name: "Online reservations" }));
  const toggle = await setting.findByRole("switch", { name: "Allow £99 reservations on the website" });
  const save = setting.getByRole("button", { name: "Save reservation setting" });
  expect(toggle).toBeChecked();
  expect(save).toBeDisabled();
  fireEvent.click(toggle);
  expect(reservations).toHaveBeenCalledTimes(1);
  fireEvent.click(save);
  expect(await setting.findByRole("status")).toHaveTextContent("Online reservations turned off.");
  expect(toggle).not.toBeChecked();
  expect(save).toBeDisabled();
  expect(reservations).toHaveBeenLastCalledWith("/api/staff/reservations/settings", expect.objectContaining({
    method: "PUT",
    body: JSON.stringify({ enabled: false }),
  }));
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
