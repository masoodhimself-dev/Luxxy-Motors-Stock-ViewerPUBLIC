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
  const view = render(
    <QueryClientProvider client={client}>
      <DealerSettingsPanel group={group} />
    </QueryClientProvider>,
  );
  return { writes, getSaved: () => saved, unmount: view.unmount };
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

it("keeps website colours fixed while publishing a logo or photograph edit", async () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = { ...settings.presentation, includedItems: ["6 months warranty"] };
  const { writes, getSaved } = show("website", settings);
  await screen.findByRole("heading", { name: "Website brand" });
  expect(screen.queryByLabelText(/colour hex code/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/colour picker/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Website colours and fonts are managed by Dealer OS/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Photograph description"), { target: { value: "Our showroom" } });
  fireEvent.click(screen.getByRole("button", { name: "Review brand" }));
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Publish brand" }));
  await screen.findByText("Website brand published.");
  expect(writes).toHaveLength(1);
  expect(getSaved().identity.brandColors).toEqual(settings.identity.brandColors);
  expect(getSaved().presentation?.heroImageAlt).toBe("Our showroom");
  expect(getSaved().presentation?.includedItems).toEqual(["6 months warranty"]);
});

it("publishes the dealership-wide inclusion list without changing unrelated presentation or brand settings", async () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = { ...settings.presentation, heroImageAlt: "Existing showroom", includedInformation: "Bring your documents." };
  const { writes, getSaved } = show("dealership", settings);
  const items = await screen.findByLabelText(/Included items/);
  fireEvent.change(items, { target: { value: " 6 months warranty \n\nPre-delivery inspection\n6 MONTHS WARRANTY" } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await screen.findByText("Dealership details saved.");
  expect(writes).toHaveLength(1);
  expect(writes[0].revision).toBe("4");
  expect(getSaved().presentation).toEqual({ ...settings.presentation, includedItems: ["6 months warranty", "Pre-delivery inspection"] });
  expect(getSaved().identity.brandColors).toEqual(settings.identity.brandColors);
  expect(getSaved().warranty).toEqual(settings.warranty);
  expect(items).toHaveValue("6 months warranty\nPre-delivery inspection");
});

it("clears a saved list explicitly and retains that empty state after reloading", async () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = { ...settings.presentation, includedItems: ["6 months warranty"] };
  const { writes, getSaved, unmount } = show("dealership", settings);
  fireEvent.change(await screen.findByLabelText(/Included items/), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await screen.findByText("Dealership details saved.");
  expect(writes[0].body.presentation.includedItems).toEqual([]);
  expect(getSaved().presentation?.includedItems).toEqual([]);
  unmount();
  show("dealership", getSaved());
  expect(await screen.findByLabelText(/Included items/)).toHaveValue("");
  expect(screen.queryByText("Currently using individual vehicle details.")).not.toBeInTheDocument();
});

it("can hide legacy vehicle inclusions without entering a replacement list", async () => {
  const { writes } = show("dealership");
  fireEvent.click(await screen.findByRole("button", { name: "Hide this section on all cars" }));
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await screen.findByText("Dealership details saved.");
  expect(writes[0].body.presentation.includedItems).toEqual([]);
});

it("does not replace individual vehicle inclusions when saving unrelated business details", async () => {
  const { writes } = show("dealership");
  fireEvent.change(await screen.findByLabelText("Dealership name"), { target: { value: "Another dealer" } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  await screen.findByText("Dealership details saved.");
  expect(writes[0].body.presentation).not.toHaveProperty("includedItems");
});

it("keeps overlong inclusion drafts without publishing them", async () => {
  const { writes } = show("dealership");
  const items = await screen.findByLabelText(/Included items/);
  fireEvent.change(items, { target: { value: "a".repeat(161) } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Add up to 12 included items");
  expect(items).toHaveValue("a".repeat(161));
  expect(writes).toHaveLength(0);
  fireEvent.change(items, { target: { value: Array.from({ length: 13 }, (_, i) => `Item ${i + 1}`).join("\n") } });
  fireEvent.click(screen.getByRole("button", { name: "Save details" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Add up to 12 included items");
  expect(writes).toHaveLength(0);
});

it('saves delivery base price and road-mile price with the existing settings revision and preserves unrelated settings',async()=>{
 const {writes,getSaved}=show('dealership');await screen.findByRole('heading',{name:'Vehicle delivery'});
 if(!(screen.getByRole('checkbox',{name:'Offer delivery on the website'}) as HTMLInputElement).checked)fireEvent.click(screen.getByRole('checkbox',{name:'Offer delivery on the website'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Show delivery cost calculator'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Base delivery price (£)'}),{target:{value:'50.00'}});fireEvent.change(screen.getByRole('textbox',{name:'Price per road mile (£)'}),{target:{value:'1.50'}});
 fireEvent.click(screen.getByRole('button',{name:'Save details'}));await waitFor(()=>expect(writes).toHaveLength(1));
 expect(writes[0]!.body.deliveryPricing).toEqual({enabled:true,basePrice:'50.00',pricePerMile:'1.50'});expect(writes[0]!.revision).toBe('4');expect(getSaved().testDriveBooking).toEqual(previewSettings.testDriveBooking);
});
it('rejects negative and over-precise delivery rates without publishing',async()=>{
 const {writes}=show('dealership');await screen.findByRole('heading',{name:'Vehicle delivery'});if(!(screen.getByRole('checkbox',{name:'Offer delivery on the website'}) as HTMLInputElement).checked)fireEvent.click(screen.getByRole('checkbox',{name:'Offer delivery on the website'}));fireEvent.click(screen.getByRole('checkbox',{name:'Show delivery cost calculator'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Base delivery price (£)'}),{target:{value:'-1'}});fireEvent.change(screen.getByRole('textbox',{name:'Price per road mile (£)'}),{target:{value:'1.005'}});fireEvent.click(screen.getByRole('button',{name:'Save details'}));await screen.findByText(/Enter delivery prices from/);expect(writes).toHaveLength(0);
});
