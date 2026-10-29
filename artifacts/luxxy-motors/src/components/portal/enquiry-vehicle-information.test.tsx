import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Car } from "@/lib/stock-context";
vi.mock("../mot-history", () => ({
  MotHistoryPanel: () => <button>View MOT history</button>,
}));
vi.mock("./history-links", () => ({
  HistoryLinks: () => (
    <a href="/portal?contextHistory=vehicle">Vehicle history</a>
  ),
}));
vi.mock("@/components/gallery", () => ({
  Gallery: ({ vehicleLabel }: any) => <p>Photos of {vehicleLabel}</p>,
}));
import { EnquiryVehicleInformation } from "./enquiry-vehicle-information";
const car = {
  id: "car-one",
  title: "Ford Mondeo",
  variant: "Titanium",
  registration: null,
  plate: null,
  vrm: null,
  price: 8244,
  currency: "GBP",
  inventoryStatus: "available",
  images: [],
  sourceExtras: {
    description: "Full supplied vehicle description.",
    specCategories: [
      {
        category: "Dimensions",
        items: [{ name: "Length", value: "4,871 mm" }],
      },
    ],
    runningCosts: { items: [{ label: "Annual road tax", value: "£200" }] },
    historyExtras: { historyItems: [{ key: "KEYS", value: "2 keys" }] },
  },
  features: ["Heated seats"],
} as unknown as Car;
it("keeps the same complete supplied facts in a phone-ready side panel", () => {
  const close = vi.fn();
  render(
    <EnquiryVehicleInformation
      car={car}
      onClose={close}
      presentation="panel"
      actions={<button>New enquiry</button>}
    />,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveClass("staff-vehicle-panel");
  expect(dialog).toHaveTextContent("£8,244");
  expect(dialog).toHaveTextContent("Titanium");
  expect(dialog).toHaveTextContent("Registration not supplied");
  expect(dialog).toHaveTextContent("Full supplied vehicle description.");
  expect(dialog).not.toHaveTextContent("preparation");
  for (const name of [
    "MOT history",
    "Running costs",
    "Recorded history",
    "Dimensions",
    "Features & equipment (1)",
  ]) {
    fireEvent.click(within(dialog).getByText(name, { selector: "summary" }));
  }
  expect(
    within(dialog).getByRole("button", { name: "View MOT history" }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent("4,871 mm");
  expect(dialog).toHaveTextContent("£200");
  expect(dialog).toHaveTextContent("2 keys");
  expect(dialog).toHaveTextContent("Heated seats");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledOnce();
});
it("shows missing prices honestly and does not offer a staff MOT action without permission", () => {
  render(
    <EnquiryVehicleInformation
      car={{ ...car, price: null }}
      onClose={() => {}}
      canManage={false}
    />,
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("Not supplied");
  expect(
    screen.queryByText("MOT history", { selector: "summary" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", {
      name: "Open customer vehicle page in a new tab",
    }),
  ).toHaveAttribute("href", "/vehicle/car-one");
});
