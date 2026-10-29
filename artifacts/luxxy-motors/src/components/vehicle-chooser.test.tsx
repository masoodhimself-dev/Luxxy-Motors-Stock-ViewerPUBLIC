import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Car } from "@/lib/stock-context";
import { VehicleChooser } from "./vehicle-chooser";
const ford = {
  id: "ford",
  title: "Ford Focus",
  make: "Ford",
  model: "Focus",
  variant: "Titanium",
  plate: "AB20 XYZ",
  year: 2020,
  price: 10000,
  currency: "GBP",
  mileage: 22000,
  fuel: "Petrol",
  colour: "Blue",
  transmission: "Manual",
  heroImage: "/ford.jpg",
  images: [],
  inventoryStatus: "available",
} as unknown as Car;
const toyota = {
  ...ford,
  id: "toyota",
  title: "Toyota Yaris",
  make: "Toyota",
  model: "Yaris",
  plate: "CD19 EFG",
  colour: "Red",
  transmission: "Automatic",
  price: 7500,
} as Car;
describe("searchable stock vehicle chooser", () => {
  it("shows identifying facts and photos, searches mixed words or compact registrations, and only selects on an explicit action", () => {
    const onChange = vi.fn();
    render(
      <VehicleChooser cars={[ford, toyota]} value="" onChange={onChange} />,
    );
    const search = screen.getByRole("searchbox", {
      name: "Search stock vehicles",
    });
    expect(
      screen.getByLabelText("Matching stock vehicles").querySelectorAll("img"),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Choose Ford Focus · AB20 XYZ" }),
    ).toHaveTextContent("22,000 miles");
    expect(
      screen.getByRole("button", { name: "Choose Ford Focus · AB20 XYZ" }),
    ).toHaveTextContent("£10,000");
    fireEvent.change(search, { target: { value: "red auto Toyota" } });
    expect(
      screen.queryByRole("button", { name: /Choose Ford/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose Toyota/ })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "ab20xyz" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("ford");
    expect(search).toHaveFocus();
  });
  it("does not silently choose between multiple matching vehicles or reset an already selected agreed price", () => {
    const onChange = vi.fn();
    render(
      <VehicleChooser cars={[ford, toyota]} value="ford" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change vehicle" }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Choose Ford/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Matching stock vehicles"),
    ).not.toBeInTheDocument();
  });
  it("retains a saved car missing from stock, locks protected selections and shows stock errors without allowing stale choices", () => {
    const onChange = vi.fn();
    const view = render(
      <VehicleChooser
        cars={[]}
        value="old"
        savedLabel="Saved Fiesta"
        onChange={onChange}
        disabled
        lockedReason="Reserved sale vehicle is locked."
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved Fiesta selected · saved vehicle details kept",
    );
    expect(screen.getByRole("searchbox")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Change vehicle" }),
    ).toBeDisabled();
    view.rerender(
      <VehicleChooser cars={[ford]} value="" onChange={onChange} failed />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Current stock could not load",
    );
    expect(
      screen.queryByRole("button", { name: /Choose Ford/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
  it("has clear loading, empty search and no-stock states and replaces failed photos with a vehicle icon", () => {
    const view = render(
      <VehicleChooser cars={[ford]} value="" onChange={vi.fn()} loading />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading stock");
    expect(
      screen.queryByLabelText("Matching stock vehicles"),
    ).not.toBeInTheDocument();
    view.rerender(<VehicleChooser cars={[ford]} value="" onChange={vi.fn()} />);
    const results = screen.getByLabelText("Matching stock vehicles");
    fireEvent.error(results.querySelector("img")!);
    expect(results.querySelector("img")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nonexistent" },
    });
    expect(within(results).getByText(/No matching cars/)).toBeVisible();
    view.rerender(<VehicleChooser cars={[]} value="" onChange={vi.fn()} />);
    expect(
      screen.getByText("No stock vehicles are available to select."),
    ).toBeVisible();
  });
});
