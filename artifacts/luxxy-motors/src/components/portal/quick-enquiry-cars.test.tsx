import { createRef, useState, type ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
type Props = ComponentProps<typeof QuickEnquiryCars>;
function mount(overrides: Partial<Props> = {}) {
 const change = vi.fn();
 function Harness() {
  const [value, setValue] = useState(overrides.value ?? "");
  return <QuickEnquiryCars cars={[toyota, mg]} disabled={false} loading={false} failed={false} {...overrides} value={value} onChange={id => { change(id); setValue(id); }} />;
 }
 return { ...render(<Harness />), change };
}
const input = () => screen.getByRole("combobox", { name: "Car (optional)" });
function search(query: string) { fireEvent.change(input(), { target: { value: query } }); }

it("starts with a small optional search without displaying or selecting the stock catalogue", () => {
 const { change } = mount();
 expect(input()).toHaveAttribute("placeholder", "Make, model or reg");
 expect(input()).not.toHaveFocus();
 expect(input()).toHaveAttribute("aria-expanded", "false");
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
 expect(screen.queryByRole("status")).not.toBeInTheDocument();
 expect(screen.queryByText("Toyota Yaris")).not.toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Browse cars" }).parentElement).toBe(input().parentElement);
 expect(screen.queryByRole("button", { name: "No specific car" })).not.toBeInTheDocument();
 expect(change).not.toHaveBeenCalled();
});

it("typing searches compact results and clicking one collapses them to the selected summary", () => {
 const { change } = mount(); search("MG HS auto red");
 const list = screen.getByRole("listbox", { name: "Matching stock cars" });
 expect(list).not.toHaveTextContent("Toyota");
 fireEvent.click(screen.getByRole("option", { name: /MG HS.*XY22 ZZZ/ }));
 expect(change).toHaveBeenCalledExactlyOnceWith("two");
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
 expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
 const selected = screen.getByRole("article", { name: "Selected car" });
 expect(selected).toHaveTextContent("MG HS");
 expect(selected).toHaveTextContent("XY22 ZZZ");
 expect(selected).toHaveTextContent("£8,990");
 expect(selected).not.toHaveTextContent("22,000");
});

it("keeps a known car compact and opens search only when Change car is chosen", async () => {
 const { change } = mount({ value: "one" });
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Toyota Yaris");
 expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Change car" }));
 await waitFor(() => expect(input()).toHaveFocus());
 expect(change).not.toHaveBeenCalled();
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
 search("MG"); fireEvent.click(screen.getByRole("option", { name: /MG HS/ }));
 expect(change).toHaveBeenCalledExactlyOnceWith("two");
});

it("does not replace the original selection when changing is cancelled", () => {
 const { change } = mount({ value: "one" });
 fireEvent.click(screen.getByRole("button", { name: "Change car" }));
 search("MG"); fireEvent.click(screen.getByRole("button", { name: "Keep selected car" }));
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Toyota Yaris");
 expect(change).not.toHaveBeenCalled();
});

it("clears the car only on the explicit No specific car action", () => {
 const { change } = mount({ value: "one" });
 fireEvent.click(screen.getByRole("button", { name: "No specific car" }));
 expect(change).toHaveBeenCalledExactlyOnceWith("");
 expect(input()).toHaveValue("");
 expect(screen.queryByRole("article", { name: "Selected car" })).not.toBeInTheDocument();
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("Enter selects an explicitly typed unique match without submitting the enquiry", () => {
 const onChange = vi.fn(); const submit = vi.fn(event => event.preventDefault());
 render(<form onSubmit={submit}><QuickEnquiryCars cars={[toyota, mg]} value="" onChange={onChange} disabled={false} loading={false} failed={false} /></form>);
 search("MG red"); fireEvent.keyDown(input(), { key: "Enter" });
 expect(onChange).toHaveBeenCalledExactlyOnceWith("two"); expect(submit).not.toHaveBeenCalled();
});

it("does not silently select the first of several matches on Enter", () => {
 const { change } = mount(); search("automatic");
 expect(screen.getAllByRole("option")).toHaveLength(2);
 fireEvent.keyDown(input(), { key: "Enter" });
 expect(change).not.toHaveBeenCalled();
 expect(screen.queryByRole("article", { name: "Selected car" })).not.toBeInTheDocument();
});

it("exposes combobox navigation and selects the keyboard-highlighted result", () => {
 const { change } = mount(); search("automatic");
 const field = input(); const options = screen.getAllByRole("option");
 expect(field).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
 expect(field).not.toHaveAttribute("aria-activedescendant");
 fireEvent.keyDown(field, { key: "ArrowDown" });
 expect(field).toHaveAttribute("aria-activedescendant", options[0].id);
 fireEvent.keyDown(field, { key: "ArrowDown" });
 expect(field).toHaveAttribute("aria-activedescendant", options[1].id);
 fireEvent.keyDown(field, { key: "ArrowUp" });
 expect(field).toHaveAttribute("aria-activedescendant", options[0].id);
 fireEvent.keyDown(field, { key: "Enter" });
 expect(change).toHaveBeenCalledExactlyOnceWith("one");
});

it("Escape dismisses results without clearing the car or closing the parent dialog", () => {
 const parentKey = vi.fn(); const onChange = vi.fn();
 render(<div onKeyDown={parentKey}><QuickEnquiryCars cars={[toyota, mg]} value="one" onChange={onChange} disabled={false} loading={false} failed={false} /></div>);
 fireEvent.click(screen.getByRole("button", { name: "Change car" })); search("MG");
 parentKey.mockClear(); fireEvent.keyDown(input(), { key: "Escape" });
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Toyota Yaris");
 expect(onChange).not.toHaveBeenCalled(); expect(parentKey).not.toHaveBeenCalled();
});

it("leaves composition Enter for the IME instead of selecting a car", () => {
 const { change } = mount(); search("MG");
 fireEvent.compositionStart(input());
 fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
 expect(change).not.toHaveBeenCalled();
 fireEvent.compositionEnd(input());
 fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
 expect(change).not.toHaveBeenCalled();
 fireEvent.keyDown(input(), { key: "Enter" });
 expect(change).toHaveBeenCalledExactlyOnceWith("two");
});

it("offers an explicit bounded browse list with access to more stock", () => {
 const cars = Array.from({ length: 12 }, (_, index) => ({ ...toyota, id: `car-${index}`, title: `Stock car ${index}` }));
 const { change } = mount({ cars });
 fireEvent.click(screen.getByRole("button", { name: "Browse cars" }));
 expect(screen.getAllByRole("option")).toHaveLength(5);
 expect(screen.getByRole("status")).toHaveTextContent("12 cars found");
 fireEvent.click(screen.getByRole("button", { name: "Show more cars" }));
 expect(screen.getAllByRole("option")).toHaveLength(10);
 fireEvent.click(screen.getByRole("button", { name: "Show more cars" }));
 expect(screen.getAllByRole("option")).toHaveLength(12);
 expect(screen.queryByRole("button", { name: "Show more cars" })).not.toBeInTheDocument();
 expect(change).not.toHaveBeenCalled();
});

it("ignores whitespace without opening a stock catalogue", () => {
 const { change } = mount(); search("   ");
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
 expect(screen.queryByRole("status")).not.toBeInTheDocument();
 expect(change).not.toHaveBeenCalled();
});

it("collapses results when staff move to another field and restores them when search is refocused", () => {
 const onChange = vi.fn();
 render(<><QuickEnquiryCars cars={[toyota, mg]} value="" onChange={onChange} disabled={false} loading={false} failed={false} /><input aria-label="Customer name" /></>);
 search("automatic");
 expect(screen.getByRole("listbox")).toBeVisible();
 fireEvent.blur(input(), { relatedTarget: screen.getByRole("textbox", { name: "Customer name" }) });
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
 expect(input()).toHaveValue("automatic");
 fireEvent.focus(input());
 expect(screen.getByRole("listbox")).toBeVisible();
 expect(onChange).not.toHaveBeenCalled();
});

it("shows useful no-match, loading and failure states without changing the selection", () => {
 const onChange = vi.fn();
 const props = { cars: [toyota, mg], value: "", onChange, disabled: false, loading: false, failed: false };
 const view = render(<QuickEnquiryCars {...props} />);
 search("not-a-car"); expect(screen.getByRole("status")).toHaveTextContent("No matching cars");
 expect(input()).toHaveAttribute("aria-expanded", "false");
 expect(input()).not.toHaveAttribute("aria-controls");
 view.rerender(<QuickEnquiryCars {...props} loading />);
 expect(screen.getByRole("status")).toHaveTextContent("Loading cars");
 expect(screen.queryByRole("option")).not.toBeInTheDocument();
 view.rerender(<QuickEnquiryCars {...props} failed />);
 expect(screen.getByRole("status")).toHaveTextContent("Cars could not load");
 expect(screen.getByRole("status")).toHaveTextContent("general enquiry");
 expect(onChange).not.toHaveBeenCalled();
});

it("retains an unavailable initial car id until staff choose a replacement or clear it", () => {
 const { change } = mount({ value: "unavailable" });
 expect(screen.getByRole("status")).toHaveTextContent("selected car is no longer in this stock list");
 expect(input()).toBeEnabled(); expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "No specific car" }));
 expect(change).toHaveBeenCalledExactlyOnceWith("");
});

it("provides the optional input ref for parent validation without initial autofocus", () => {
 const inputRef = createRef<HTMLInputElement>(); mount({ inputRef });
 expect(inputRef.current).toBe(input()); expect(input()).not.toHaveFocus();
 inputRef.current?.focus(); expect(input()).toHaveFocus();
});

it("associates the parent's inline validation error with the focusable car search", () => {
 const inputRef = createRef<HTMLInputElement>();
 const { change } = mount({ value: "unavailable", inputRef, error: "Choose an available car for this test drive." });
 const error = screen.getByRole("alert");
 expect(error).toHaveTextContent("Choose an available car for this test drive.");
 expect(input()).toHaveAttribute("aria-invalid", "true");
 expect(input()).toHaveAttribute("aria-describedby", error.id);
 expect(screen.getAllByText("Choose an available car for this test drive.")).toHaveLength(1);
 inputRef.current?.focus(); expect(input()).toHaveFocus();
 expect(change).not.toHaveBeenCalled();
});

it("reveals a selected car's search synchronously for validation focus without clearing its id", () => {
 const inputRef = createRef<HTMLInputElement>(); const onChange = vi.fn();
 const props = { cars: [toyota, mg], value: "one", onChange, disabled: false, loading: false, failed: false, inputRef };
 const view = render(<QuickEnquiryCars {...props} />);
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Toyota Yaris");
 expect(inputRef.current).toBeNull();
 view.rerender(<QuickEnquiryCars {...props} error="This car cannot be booked. Choose another car." />);
 const field = input();
 expect(inputRef.current).toBe(field);
 expect(field).toHaveAttribute("aria-invalid", "true");
 expect(field).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
 expect(screen.getByText(/Currently: Toyota Yaris/)).toHaveTextContent("AB12 CDE");
 inputRef.current?.focus(); expect(field).toHaveFocus();
 expect(onChange).not.toHaveBeenCalled();
 view.rerender(<QuickEnquiryCars {...props} />);
 expect(screen.getByRole("article", { name: "Selected car" })).toHaveTextContent("Toyota Yaris");
 expect(onChange).not.toHaveBeenCalled();
});

it("disables search, clearing, details and changing while a save is pending", () => {
 const { change } = mount({ value: "one", disabled: true });
 for (const label of ["Change car", "Car details", "No specific car"]) {
  const button = screen.getByRole("button", { name: label });
  expect(button).toBeDisabled(); fireEvent.click(button);
 }
 expect(change).not.toHaveBeenCalled();
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("opens actual vehicle details without navigating away or changing the selected car", () => {
 const onChange = vi.fn();
 render(<QuickEnquiryCars cars={[{ ...toyota, description: "Two keys and recorded service history.", features: ["Heated front seats", "Bluetooth"], writeOffCategory: "S" }]} value="one" onChange={onChange} disabled={false} loading={false} failed={false} />);
 fireEvent.click(screen.getByRole("button", { name: "Car details" }));
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
 fireEvent.click(screen.getByRole("button", { name: "Car details" }));
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
