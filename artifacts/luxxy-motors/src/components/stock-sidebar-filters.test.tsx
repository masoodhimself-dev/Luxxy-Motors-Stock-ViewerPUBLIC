import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Filters, type FilterState } from "./filters";
import type { Car } from "@/lib/stock-context";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => viewport.mobile,
}));

const empty: FilterState = {
  make: "",
  model: "",
  minPrice: "",
  maxPrice: "",
  fuel: "",
  transmission: "",
  bodyType: "",
  search: "",
  ulez: false,
  sort: "",
};
const cars = [
  {
    id: "bmw-1",
    make: "BMW",
    model: "1 Series",
    price: 5000,
    fuel: "Petrol",
    transmission: "Manual",
    bodyType: "Hatchback",
  },
  {
    id: "bmw-3",
    make: "BMW",
    model: "3 Series",
    price: 10000,
    fuel: "Diesel",
    transmission: "Automatic",
    bodyType: "Saloon",
  },
  {
    id: "audi-3",
    make: "Audi",
    model: "A3",
    price: 20000,
    fuel: "Petrol",
    transmission: "Automatic",
    bodyType: "Hatchback",
  },
] as Car[];

function Harness({
  initial = {},
  onSearch = () => {},
}: {
  initial?: Partial<FilterState>;
  onSearch?: () => void;
}) {
  const [filters, setFilters] = useState<FilterState>({ ...empty, ...initial });
  return (
    <>
      <Filters
        cars={cars}
        filters={filters}
        setFilters={setFilters}
        vehicleCount={3}
        matchCount={3}
        onSearch={onSearch}
      />
      <pre data-testid="filter-state">{JSON.stringify(filters)}</pre>
    </>
  );
}
const state = () =>
  JSON.parse(screen.getByTestId("filter-state").textContent!) as FilterState;

beforeEach(() => {
  viewport.mobile = false;
});

describe("responsive stock filters", () => {
  it("exposes desktop filters directly without a redundant filter dialog trigger", () => {
    render(<Harness />);
    const sidebar = screen.getByRole("complementary", { name: "Filter cars" });
    expect(
      within(sidebar).getByRole("combobox", { name: "Make" }),
    ).toBeVisible();
    expect(
      within(sidebar).getByRole("combobox", { name: "Model" }),
    ).toBeDisabled();
    expect(
      within(sidebar).getByRole("button", { name: "Reset filters" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Advanced search" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("combobox", { name: "Sort results" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("textbox", { name: "Search the showroom" }),
    ).toHaveLength(1);
  });

  it("opens mobile filters with the same state and applies them through the results action", async () => {
    viewport.mobile = true;
    const onSearch = vi.fn();
    render(
      <Harness
        initial={{ make: "BMW", model: "3 Series" }}
        onSearch={onSearch}
      />,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Advanced search" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Filter used cars" });
    expect(within(dialog).getByRole("combobox", { name: "Make" })).toHaveValue(
      "BMW",
    );
    expect(within(dialog).getByRole("combobox", { name: "Model" })).toHaveValue(
      "3 Series",
    );
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Make" }), {
      target: { value: "Audi" },
    });
    expect(state()).toMatchObject({ make: "Audi", model: "" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show 3 cars" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "Remove Audi filter" }),
    ).toBeVisible();
  });

  it("moves focus to results after applying, but returns to Filters when dismissed", async () => {
    viewport.mobile = true;
    const results = document.createElement("div");
    results.tabIndex = -1;
    document.body.append(results);
    try {
      const onSearch = vi.fn(() => results.focus());
      render(<Harness onSearch={onSearch} />);
      const trigger = screen.getByRole("button", { name: "Advanced search" });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("button", { name: "Show 3 cars" }));
      await waitFor(() => expect(results).toHaveFocus());
      expect(onSearch).toHaveBeenCalledTimes(1);
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(onSearch).toHaveBeenCalledTimes(1);
    } finally {
      results.remove();
    }
  });

  it("closes the drawer on desktop rotation and retains exactly one field set and its values", async () => {
    viewport.mobile = true;
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced search" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Make" }), {
      target: { value: "BMW" },
    });
    viewport.mobile = false;
    view.rerender(<Harness />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("complementary", { name: "Filter cars" }),
    ).toBeVisible();
    expect(screen.getAllByRole("combobox", { name: "Make" })).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Make" })).toHaveValue("BMW");
    expect(
      screen.queryByRole("button", { name: "Advanced search" }),
    ).not.toBeInTheDocument();
    viewport.mobile = true;
    view.rerender(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advanced search" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Advanced search" }));
    expect(screen.getByRole("combobox", { name: "Make" })).toHaveValue("BMW");
  });

  it("retains the dealership panel palette in the portalled mobile drawer", () => {
    viewport.mobile = true;
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Advanced search" });
    trigger.style.setProperty("--dealer-panel-ink-hsl", "0 0% 100%");
    trigger.style.setProperty("--dealer-panel-accent-hsl", "40 80% 50%");
    trigger.style.setProperty("--premium-panel", "#18232e");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.getPropertyValue("--dealer-panel-ink-hsl")).toBe(
      "0 0% 100%",
    );
    expect(dialog.style.getPropertyValue("--dealer-panel-accent-hsl")).toBe(
      "40 80% 50%",
    );
    expect(dialog.style.getPropertyValue("--premium-panel")).toBe("#18232e");
  });
});

describe("shared filter behaviour", () => {
  it("clears a previous model when changing make and offers only the new make's models", () => {
    render(<Harness initial={{ make: "BMW", model: "3 Series" }} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Make" }), {
      target: { value: "Audi" },
    });
    const model = screen.getByRole("combobox", { name: "Model" });
    expect(state()).toMatchObject({ make: "Audi", model: "" });
    expect(
      within(model)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Any model", "A3"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Make" }), {
      target: { value: "" },
    });
    expect(model).toBeDisabled();
  });

  it("resolves budget conflicts in both directions without retaining an impossible range", () => {
    render(<Harness initial={{ maxPrice: "10000" }} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Min budget" }), {
      target: { value: "20000" },
    });
    expect(state()).toMatchObject({ minPrice: "20000", maxPrice: "" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Maximum budget cleared",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Max budget" }), {
      target: { value: "5000" },
    });
    expect(state()).toMatchObject({ minPrice: "", maxPrice: "5000" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Minimum budget cleared",
    );
  });

  it("removes dependent make/model chips and resets every filter including sort", () => {
    render(
      <Harness
        initial={{
          make: "BMW",
          model: "3 Series",
          search: "heated seats",
          minPrice: "5000",
          fuel: "Petrol",
          transmission: "Automatic",
          ulez: true,
          sort: "price-desc",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove BMW filter" }));
    expect(state()).toMatchObject({
      make: "",
      model: "",
      sort: "price-desc",
      search: "heated seats",
    });
    expect(
      screen.queryByRole("button", { name: "Remove 3 Series filter" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(state()).toEqual(empty);
    expect(screen.queryByLabelText("Applied filters")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort results" })).toHaveValue(
      "",
    );
  });
});
