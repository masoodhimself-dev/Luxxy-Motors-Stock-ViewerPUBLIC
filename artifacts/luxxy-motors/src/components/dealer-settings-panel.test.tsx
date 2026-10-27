import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealerSettingsPanel } from "./dealer-settings-panel";
import type { DealerSettingsGroup } from "@/lib/settings-simplification";
import { previewSettings } from "../../preview/settings";
const clients: QueryClient[] = [];
function show(
  group: DealerSettingsGroup = "bookings",
  initial = structuredClone(previewSettings),
) {
  let saved = initial,
    revision = 4;
  const writes: { url: string; body: any; revision: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = String(input);
      if (url === "/api/features")
        return Response.json({ features: { testDriveBookings: true } });
      if (init?.method === "PATCH") {
        const body = JSON.parse(init.body);
        writes.push({
          url,
          body,
          revision: new Headers(init.headers).get("If-Match"),
        });
        if (url.endsWith("/bookings")) {
          saved = {
            ...saved,
            testDriveBooking: {
              ...saved.testDriveBooking!,
              ...body.testDriveBooking,
            },
          };
          revision++;
          return Response.json(
            { testDriveBooking: saved.testDriveBooking, revision },
            { headers: { "x-settings-revision": String(revision) } },
          );
        }
        saved = body;
        revision++;
      }
      return Response.json(saved, {
        headers: { "x-settings-revision": String(revision) },
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DealerSettingsPanel group={group} />
    </QueryClientProvider>,
  );
  return { writes, getSaved: () => saved };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});
it("disables bookings with a narrow write even when unrelated website content is invalid", async () => {
  const settings = structuredClone(previewSettings);
  settings.hero.copy = "";
  settings.warranty.title = "";
  settings.testDriveBooking!.enabled = true;
  const { writes, getSaved } = show("bookings", settings);
  const toggle = await screen.findByTestId("checkbox-test-drive-enabled");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Save bookings" }));
  await screen.findByText("Booking settings saved.");
  expect(writes).toHaveLength(1);
  expect(writes[0].url).toBe("/api/dealer-settings/bookings");
  expect(Object.keys(writes[0].body)).toEqual(["testDriveBooking"]);
  expect(writes[0].body.testDriveBooking.enabled).toBe(false);
  expect(writes[0].revision).toBe("4");
  expect(getSaved().hero.copy).toBe("");
  expect(getSaved().warranty.title).toBe("");
});
it("uses the new revision for a second booking change", async () => {
  const { writes } = show();
  const toggle = await screen.findByTestId("checkbox-test-drive-enabled");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Save bookings" }));
  await screen.findByText("Booking settings saved.");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save bookings" }),
    ).toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId("checkbox-test-drive-enabled"));
  fireEvent.click(screen.getByRole("button", { name: "Save bookings" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes.map((write) => write.revision)).toEqual(["4", "5"]);
});
it("does not offer layouts, AI, watch, QR or separate document branding controls", async () => {
  show("website");
  await screen.findByRole("heading", { name: "Website brand" });
  expect(screen.queryByText(/template/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/WhatsApp QR/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/watch this car/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review brand" })).toBeDisabled();
});
it("preserves nonstandard existing showroom hours without crashing or changing them on load", async () => {
  const settings = structuredClone(previewSettings);
  settings.hours = [{ days: "By appointment", times: "Please call" }];
  const { writes } = show("dealership", settings);
  expect(await screen.findByLabelText("Days for opening hours 1")).toHaveValue(
    "By appointment",
  );
  expect(screen.getByLabelText("Times for opening hours 1")).toHaveValue(
    "Please call",
  );
  expect(writes).toHaveLength(0);
});

it("does not review or publish the previous colour while an invalid hex edit is visible", async () => {
  const { writes } = show("website");
  await screen.findByRole("heading", { name: "Website brand" });
  fireEvent.change(screen.getByLabelText("Main colour hex code"), {
    target: { value: "#123456" },
  });
  fireEvent.change(screen.getByLabelText("Accent colour hex code"), {
    target: { value: "#nope" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review brand" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Check the highlighted brand colour",
  );
  expect(screen.getByRole("button", { name: "Review brand" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Publish brand" }),
  ).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
