import { expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Car } from "@/lib/stock-context";
import { matchesEnquiryCar, QuickEnquiryCars } from "./quick-enquiry-cars";
const toyota = { id: "one", title: "Toyota Yaris", make: "Toyota", model: "Yaris", colour: "Black", transmission: "Automatic", fuel: "Petrol", price: 8990, mileage: 22000, plate: "AB12 CDE", inventoryStatus: "available", images: [] } as unknown as Car;
const mg = { ...toyota, id: "two", title: "MG HS", make: "MG", model: "HS", colour: "Red", plate: "XY22 ZZZ" };
it("matches every search term in any order, with auto shorthand and spaced registrations", () => {
 expect(matchesEnquiryCar(toyota, "Toyota black automatic")).toBe(true);
 expect(matchesEnquiryCar(mg, "MG HS auto red")).toBe(true);
 expect(matchesEnquiryCar(mg, "red auto HS MG")).toBe(true);
 expect(matchesEnquiryCar(toyota, "AB12CDE")).toBe(true);
 expect(matchesEnquiryCar({ ...toyota, plate: null, vrm: null, registration: 'AB12 CDE' }, "AB12CDE")).toBe(true);
 expect(matchesEnquiryCar(toyota, "Toyota red")).toBe(false);
 expect(matchesEnquiryCar(toyota, "manual")).toBe(false);
});
it("shows immediate car facts and allows switching without editing customer data", () => {
 const onChange = vi.fn();
 render(<QuickEnquiryCars cars={[toyota, mg]} value="one" onChange={onChange} disabled={false} loading={false} failed={false} />);
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("22,000");
 fireEvent.change(screen.getByRole("searchbox"), { target: { value: "MG HS auto red" } });
 expect(screen.getByLabelText("Matching stock cars")).not.toHaveTextContent("Toyota");
 fireEvent.click(screen.getByRole("button", { name: /MG HS/ }));
 expect(onChange).toHaveBeenCalledWith("two");
});

it("Enter in search selects a unique match without submitting the enquiry", () => {
 const onChange = vi.fn(); const submit = vi.fn(event => event.preventDefault());
 render(<form onSubmit={submit}><QuickEnquiryCars cars={[toyota, mg]} value="" onChange={onChange} disabled={false} loading={false} failed={false} /></form>);
 fireEvent.change(screen.getByRole("searchbox"), { target: { value: "MG red" } });
 fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
 expect(onChange).toHaveBeenCalledWith("two"); expect(submit).not.toHaveBeenCalled();
});

it("opens actual vehicle details without navigating away or changing the selected car", () => {
 const onChange = vi.fn();
 render(<QuickEnquiryCars cars={[{ ...toyota, description: "Two keys and recorded service history.", features: ["Heated front seats", "Bluetooth"], writeOffCategory: "S" }]} value="one" onChange={onChange} disabled={false} loading={false} failed={false} />);
 fireEvent.click(screen.getByRole("button", { name: "See car details" }));
 const panel = screen.getByRole("dialog");
 expect(panel).toHaveTextContent("Two keys and recorded service history.");
 expect(panel).toHaveTextContent("Heated front seats");
 expect(panel).toHaveTextContent("Recorded write-off category: S");
 expect(panel).toHaveTextContent("£8,990");
 expect(onChange).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Back to enquiry" }));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Toyota Yaris");
});

it("shows recorded running costs, history and dimensions without calculating new facts", () => {
 render(<QuickEnquiryCars cars={[{ ...toyota, variant: "Excel", trim: "Premium", drivetrain: "Front wheel drive", sourceExtras: { runningCosts: { items: [{ label: "Tax per year", value: "£35" }, { label: "Average", value: "55.4 mpg" }] }, historyExtras: { serviceHistory: { description: "Full service history" }, historyItems: [{ key: "KEYS", value: "2 keys" }] }, specCategories: [{ category: "Dimensions", items: [{ name: "Boot space (seats up)", value: "286 litres" }] }] } }]} value="one" onChange={vi.fn()} disabled={false} loading={false} failed={false} />);
 fireEvent.click(screen.getByRole("button", { name: "See car details" }));
 const panel = screen.getByRole("dialog");
 expect(panel).toHaveTextContent("Excel");
 expect(panel).toHaveTextContent("Front wheel drive");
 for (const heading of ["Running costs", "Recorded history", "Dimensions"]) fireEvent.click(screen.getByText(heading).closest("summary")!);
 expect(panel).toHaveTextContent("Tax per year£35");
 expect(panel).toHaveTextContent("55.4 mpg");
 expect(panel).toHaveTextContent("Full service history");
 expect(panel).toHaveTextContent("2 keys");
 expect(panel).toHaveTextContent("286 litres");
 expect(panel).not.toHaveTextContent("monthly");
});
