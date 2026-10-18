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
