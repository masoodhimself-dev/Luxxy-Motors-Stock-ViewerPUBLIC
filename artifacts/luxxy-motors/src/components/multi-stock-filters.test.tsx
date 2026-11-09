import { useState } from "react";
import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Car } from "@/lib/stock-context";
import { applyStockFilters } from "@/features/stock-search/apply-filters";
import {
  createStockFilters,
  updateStockFilters,
} from "@/features/stock-search/url";
import type { StockFilters } from "@/features/stock-search/types";
import { MultiStockFilters } from "./multi-stock-filters";

const car = (id: string, fields: Partial<Car> = {}) =>
  ({
    id,
    advertId: id,
    title: null,
    make: null,
    model: null,
    price: null,
    mileage: null,
    fuel: null,
    transmission: null,
    bodyType: null,
    colour: null,
    engineCC: null,
    engineSize: null,
    seats: null,
    sourceExtras: null,
    emissionClass: null,
    ...fields,
  }) as Car;
const stock = [
  car("focus", {
    title: "Ford Focus",
    make: "Ford",
    model: "Focus",
    price: 5000,
    mileage: 25000,
    transmission: "Manual",
    fuel: "Petrol",
    bodyType: "Hatchback",
    colour: "Blue",
    engineCC: 999,
    seats: 5,
    emissionClass: "Euro 6",
  }),
  car("fiesta", {
    title: "Ford Fiesta",
    make: "Ford",
    model: "Fiesta",
    price: 8000,
    mileage: 120000,
    transmission: "Automatic DCT",
    fuel: "Diesel",
    bodyType: "Estate",
    colour: "Red",
    engineCC: 1998,
    seats: 5,
    emissionClass: "Euro 5",
  }),
  car("yaris", {
    title: "Toyota Yaris",
    make: "Toyota",
    model: "Yaris",
    price: 10000,
    mileage: 65000,
    transmission: "Automatic",
    fuel: "Petrol Hybrid",
    bodyType: "Hatchback",
    colour: "White",
    engineCC: 1498,
    seats: 5,
    emissionClass: "Euro 6",
  }),
  car("x5", {
    title: "BMW X5",
    make: "BMW",
    model: "X5",
    price: 35000,
    mileage: 260000,
    transmission: "Automatic",
    fuel: "Diesel",
    bodyType: "SUV",
    colour: "Black",
    engineCC: 2993,
    seats: 7,
    emissionClass: "Euro 6",
  }),
  car("leaf", {
    title: "Nissan Leaf",
    make: "Nissan",
    model: "Leaf",
    price: 12000,
    mileage: 90000,
    transmission: "Automatic",
    fuel: "Electric",
    bodyType: "Hatchback",
    colour: "Silver",
    engineCC: 0,
    engineSize: "0.0L",
    seats: 5,
  }),
  car("unknown", {
    title: "Audi A3",
    make: "Audi",
    model: "A3",
    createdAt: "2026-11-01T08:00:00Z",
  }),
];

type HarnessProps = {
  initial?: Partial<StockFilters>;
  cars?: Car[];
  patch?: (value: Partial<StockFilters>) => void;
  clear?: () => void;
  showResults?: () => void;
};
function Harness({
  initial = {},
  cars = stock,
  patch,
  clear,
  showResults,
}: HarnessProps) {
  const [filters, setFilters] = useState<StockFilters>({
    ...createStockFilters(),
    ...initial,
  });
  return (
    <>
      <button
        type="button"
        data-testid="navigation-reset"
        onClick={() => setFilters(createStockFilters())}
      >
        Reset from navigation
      </button>
      <button
        type="button"
        onClick={() =>
          setFilters({
            ...createStockFilters(),
            make: "Toyota",
            search: "Yaris",
          })
        }
      >
        Navigate to saved search
      </button>
      <MultiStockFilters
        cars={cars}
        filters={filters}
        onChange={(value) => {
          patch?.(value);
          setFilters((current) => updateStockFilters(current, value, cars));
        }}
        onClear={() => {
          clear?.();
          setFilters(createStockFilters());
        }}
        matchCount={applyStockFilters(cars, filters).total}
        onShowResults={showResults}
      />
      <pre data-testid="filter-state">{JSON.stringify(filters)}</pre>
      <button type="button" data-testid="results-focus">
        Results
      </button>
    </>
  );
}
const state = () =>
  JSON.parse(screen.getByTestId("filter-state").textContent!) as StockFilters;
const sidebar = () =>
  screen.getByRole("complementary", { name: "Filter cars" });
const expand = (name: RegExp | string, container = sidebar()) =>
  fireEvent.click(within(container).getByRole("button", { name }));
const setWidth = (width: number) =>
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
const originalWidth = window.innerWidth;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setWidth(originalWidth);
});

describe("Multi-Choice stock controls", () => {
  it("puts common filters first with the supplied SVGs and every section initially collapsed", () => {
    const { container } = render(<Harness />);
    expect(within(sidebar()).getByRole("heading", { name: "Search Filters" })).toBeVisible();
    const rows = [...sidebar().querySelectorAll<HTMLButtonElement>(".multi-stock-section__toggle")];
    const expected = [
      ["Price range", "11-filter-max-price-badge-pound-sterling.svg"],
      ["Make", "02-filter-make-car.svg"],
      ["Model", "05-filter-model-layout-list.svg"],
      ["Gearbox", "08-filter-engine-size-and-gearbox-settings.svg"],
      ["Fuel Type", "12-filter-fuel-type-fuel.svg"],
      ["Body Type", "07-filter-body-type-and-vehicle-type-truck.svg"],
      ["Colour", "06-filter-colour-palette.svg"],
      ["Seats", "09-filter-seats-users.svg"],
      ["Engine Size", "08-filter-engine-size-and-gearbox-settings.svg"],
      ["Mileage", "10-filter-mileage-gauge.svg"],
      ["ULEZ", "13-filter-ulez-leaf.svg"],
    ];
    expect(rows.map(row => row.getAttribute("aria-label"))).toEqual(expected.map(([name]) => name));
    rows.forEach((row, index) => {
      expect(row).toHaveAttribute("aria-expanded", "false");
      expect(document.getElementById(row.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
      const icon = row.querySelector<HTMLImageElement>("img[data-filter-icon]")!;
      expect(icon).toHaveAttribute("src", `/brand/multi-choice-motors/filters/${expected[index][1]}`);
      expect(icon).toHaveAttribute("alt", "");
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(icon).toHaveAttribute("width", expected[index][0] === "Make" ? "20" : "16");
      expect(readFileSync(`public/brand/multi-choice-motors/filters/${expected[index][1]}`, "utf8")).toContain("<svg");
      expect(row.querySelector('img[data-filter-icon="chevron"]')).toHaveAttribute("src", "/brand/multi-choice-motors/filters/03-chevron-down.svg");
    });
    const css = readFileSync("src/components/multi-stock-filters.css", "utf8");
    expect(css).toMatch(/--app-font-sans:\s*["']Multi Stock Montserrat["']/);
    for (const weight of [400, 500, 700]) {
      const path = `/brand/multi-choice-motors/fonts/montserrat-latin-${weight}.woff2`;
      expect(css).toContain(path);
      expect(readFileSync(`public${path}`).byteLength).toBeGreaterThan(0);
    }
    const sheet = document.createElement("style");
    sheet.textContent = css;
    document.head.append(sheet);
    try {
      const rowStyle = getComputedStyle(rows[0]);
      expect(rowStyle.fontSize).toBe("14px");
      expect(rowStyle.fontWeight).toBe("700");
      expect(rowStyle.lineHeight).toBe("20px");
      expect(rowStyle.padding).toBe("20px 8px");
    } finally {
      sheet.remove();
    }
    expect(
      within(sidebar()).queryByRole("combobox", { name: "Min price" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar()).queryByRole("button", { name: "Clear All" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar()).queryByRole("checkbox", { name: "Ford" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search cars" }),
    ).toHaveAttribute("maxLength", "200");
    expect(
      screen.queryByRole("button", { name: /^Search$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Sort cars" }),
    ).toHaveDisplayValue("Recommended");
    expect(screen.getByRole("status")).toHaveTextContent("6 cars");
    expect(container.querySelector("article,#vehicle-results")).toBeNull();
    expect(
      container.querySelector(".stock-filter-sidebar.multi-stock-filters"),
    ).not.toBeNull();
    expect(
      container.querySelector(".stock-catalogue-controls.multi-stock-controls"),
    ).not.toBeNull();
  });

  it("uses only actual listing dates for Newest listed while retaining an existing undated order", () => {
    const { rerender } = render(<Harness />);
    expect(
      screen.queryByRole("option", { name: "Newest listed" }),
    ).not.toBeInTheDocument();
    rerender(
      <Harness
        cars={[...stock, car("dated", { listedAt: "2026-10-01T08:00:00Z" })]}
      />,
    );
    expect(screen.getByRole("option", { name: "Newest listed" })).toHaveValue(
      "arrival-desc",
    );
    rerender(<Harness key="saved" initial={{ sort: "arrival-desc" }} />);
    expect(
      screen.getByRole("combobox", { name: "Sort cars" }),
    ).toHaveDisplayValue("Saved stock order");
    expect(
      screen.queryByRole("option", { name: "Newest listed" }),
    ).not.toBeInTheDocument();
  });

  it("shows plain facet labels without car counts while keeping the overall result total", () => {
    render(<Harness />);
    for (const title of ["Make", "Model", "Colour", "Body Type", "Engine Size", "Seats", "Fuel Type", "Gearbox", "ULEZ"]) expand(title);
    const options = within(sidebar()).getAllByRole("checkbox");
    expect(options.length).toBeGreaterThan(8);
    for (const option of options) {
      expect(option).not.toHaveAccessibleDescription();
      expect(option).not.toHaveAttribute("aria-describedby");
      expect(option.closest("label")).not.toHaveTextContent(/matching cars?/);
    }
    expect(sidebar().querySelector(".multi-stock-option__count")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("6 cars");
    fireEvent.click(within(sidebar()).getByRole("checkbox", { name: "Ford" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 cars");
  });

  it("keeps unavailable selected choices removable and disables only unselected zero-result options", () => {
    render(<Harness initial={{ make: "Saab", transmission: "Manual" }} />);
    expand("Make, 1 selected");
    const panel = within(sidebar());
    const missing = panel.getByRole("checkbox", { name: "Saab" });
    expect(missing).toBeChecked();
    expect(missing).toBeEnabled();
    expect(missing).not.toHaveAccessibleDescription();
    expect(panel.getByRole("checkbox", { name: "Toyota" })).toBeDisabled();
    expect(panel.getByRole("checkbox", { name: "Ford" })).toBeEnabled();
    expect(
      panel.getByRole("checkbox", { name: "Ford" }),
    ).not.toHaveAccessibleDescription();
    fireEvent.click(missing);
    expect(state().make).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
    expect(
      screen.queryByRole("button", { name: "Remove make Saab filter" }),
    ).not.toBeInTheDocument();
  });

  it("shows the first eight options and allows the full list without losing selected missing makes", () => {
    const cars = Array.from({ length: 12 }, (_, index) =>
      car(`make-${index}`, { make: `Make ${String(index).padStart(2, "0")}` }),
    );
    render(<Harness cars={cars} initial={{ make: "Zed" }} />);
    expand("Make, 1 selected");
    const group = within(sidebar()).getByRole("group", {
      name: "Make options",
    });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(8);
    expect(within(group).getByRole("checkbox", { name: "Zed" })).toBeChecked();
    fireEvent.click(
      within(sidebar()).getByRole("button", { name: "Show all (13)" }),
    );
    expect(within(group).getAllByRole("checkbox")).toHaveLength(13);
    fireEvent.click(
      within(sidebar()).getByRole("button", { name: "Show less" }),
    );
    expect(within(group).getAllByRole("checkbox")).toHaveLength(8);
    expect(within(group).getByRole("checkbox", { name: "Zed" })).toBeChecked();
  });

  it("uses OR selections within a make facet, dependent model choices and deliberate model pruning", () => {
    render(<Harness initial={{ make: "Ford,Toyota", model: "Focus,Yaris" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 cars");
    expand("Model, 2 selected");
    expect(
      within(sidebar()).queryByRole("checkbox", { name: "X5" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar()).getByRole("checkbox", { name: "Focus" }),
    ).toBeChecked();
    expect(
      within(sidebar()).getByRole("checkbox", { name: "Yaris" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove make Toyota filter" }),
    );
    expect(state()).toMatchObject({ make: "Ford", model: "Focus" });
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
  });

  it("lets shoppers add another make and its model without first losing their existing model choice", () => {
    render(<Harness initial={{ make: "Ford", model: "Focus" }} />);
    expand("Make, 1 selected");
    const toyota = within(sidebar()).getByRole("checkbox", { name: "Toyota" });
    expect(toyota).toBeEnabled();
    fireEvent.click(toyota);
    expect(state()).toMatchObject({ make: "Ford,Toyota", model: "Focus" });
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
    expand("Model, 1 selected");
    const yaris = within(sidebar()).getByRole("checkbox", { name: "Yaris" });
    expect(yaris).toBeEnabled();
    fireEvent.click(yaris);
    expect(state()).toMatchObject({ make: "Ford,Toyota", model: "Focus,Yaris" });
    expect(screen.getByRole("status")).toHaveTextContent("2 cars");
  });

  it("uses genuine finite budget caps and preserves custom linked budgets with valid counterpart changes", () => {
    render(<Harness initial={{ minPrice: "7600", maxPrice: "9000" }} />);
    expand("Price range, 2 selected");
    const min = within(sidebar()).getByRole("combobox", { name: "Min price" });
    const max = within(sidebar()).getByRole("combobox", { name: "Max price" });
    expect(min).toHaveValue("7600");
    expect(max).toHaveValue("9000");
    expect(within(max).getByRole("option", { name: "£35,000" })).toHaveValue(
      "35000",
    );
    expect(within(max).getByRole("option", { name: "Any price" })).toHaveValue(
      "",
    );
    fireEvent.change(min, { target: { value: "10000" } });
    expect(state()).toMatchObject({ minPrice: "10000", maxPrice: "" });
    fireEvent.change(max, { target: { value: "5000" } });
    expect(state()).toMatchObject({ minPrice: "", maxPrice: "5000" });
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
    fireEvent.change(max, { target: { value: "" } });
    expect(state().maxPrice).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("6 cars");
  });

  it("shows useful stock-backed extra facets and labelled colour choices without zero-litre EV claims", () => {
    render(<Harness />);
    expand("Colour");
    expect(
      within(sidebar()).getByRole("checkbox", { name: "Blue" }),
    ).not.toHaveAccessibleDescription();
    fireEvent.click(within(sidebar()).getByRole("checkbox", { name: "Blue" }));
    expect(state().colour).toBe("Blue");
    expect(
      screen.getByRole("button", { name: "Remove colour Blue filter" }),
    ).toBeVisible();
    expand("Engine Size");
    expect(
      within(sidebar()).getByRole("checkbox", { name: "1.0L" }),
    ).toBeEnabled();
    expect(
      within(sidebar()).queryByRole("checkbox", { name: "0.0L" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar()).getByRole("button", { name: "Seats" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("retains supplied single-value facets and keeps an unavailable selected seat removable", () => {
    const { rerender } = render(<Harness cars={[stock[0]]} />);
    expand("Seats");
    expect(within(sidebar()).getByRole("checkbox", { name: "5" })).not.toHaveAccessibleDescription();
    expand("Colour");
    expect(within(sidebar()).getByRole("checkbox", { name: "Blue" })).not.toHaveAccessibleDescription();
    rerender(
      <Harness key="selected" cars={[stock[0]]} initial={{ seats: "7" }} />,
    );
    expand("Seats, 1 selected");
    expect(
      within(sidebar()).getByRole("checkbox", { name: "7" }),
    ).toBeEnabled();
    expect(
      within(sidebar()).getByRole("checkbox", { name: "7" }),
    ).toBeChecked();
  });

  it("shows honest empty details for missing seats, vehicle type and unconfirmed ULEZ without guessing from the body", () => {
    render(<Harness cars={[car("unknown-details", { make: "BMW", model: "X5", bodyType: "SUV", fuel: "Electric" })]} />);
    expect(within(sidebar()).queryByRole("button", { name: "Seats" })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole("checkbox", { name: "5" })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole("button", { name: "Vehicle Type" })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole("checkbox", { name: /^(Car|Van)$/ })).not.toBeInTheDocument();
    expand("ULEZ");
    expect(within(sidebar()).getByText("No stock is currently confirmed ULEZ compliant.")).toBeVisible();
    expect(within(sidebar()).queryByRole("checkbox", { name: "ULEZ compliant" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
  });

  it("offers explicit Any mileage, useful higher bands and a custom linked mileage cap", () => {
    render(<Harness initial={{ mileage: "96000" }} />);
    expand("Mileage, 1 selected");
    const max = within(sidebar()).getByRole("combobox", {
      name: "Maximum mileage",
    });
    expect(max).toHaveValue("96000");
    expect(
      within(max).getByRole("option", { name: "Up to 300,000 miles" }),
    ).toHaveValue("300000");
    expect(
      within(max).getByRole("option", { name: "Any mileage" }),
    ).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("3 cars");
    fireEvent.change(max, { target: { value: "50000" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
    fireEvent.change(max, { target: { value: "" } });
    expect(screen.getByRole("status")).toHaveTextContent("6 cars");
    expect(
      screen.queryByRole("button", { name: "Remove mileage filter" }),
    ).not.toBeInTheDocument();
  });

  it("uses existing ULEZ truth, retains a selected zero-result switch and never infers unknown compliance", () => {
    render(<Harness cars={[stock[4]]} initial={{ ulez: true }} />);
    expand("ULEZ, 1 selected");
    const checkbox = within(sidebar()).getByRole("checkbox", {
      name: "ULEZ compliant",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(checkbox).not.toHaveAccessibleDescription();
    expect(screen.getByRole("status")).toHaveTextContent("0 cars");
    fireEvent.click(checkbox);
    expect(state().ulez).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
    expect(
      within(sidebar()).queryByRole("checkbox", { name: "ULEZ compliant" }),
    ).not.toBeInTheDocument();
  });

  it("debounces keyword changes before applying the stock search", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    render(<Harness patch={patch} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search cars" }), {
      target: { value: "Ford" },
    });
    act(() => vi.advanceTimersByTime(249));
    expect(patch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(patch).toHaveBeenCalledExactlyOnceWith({ search: "Ford" });
    expect(state().search).toBe("Ford");
    expect(screen.getByRole("status")).toHaveTextContent("2 cars");
  });

  it("uses the latest callback when the parent rerenders during a pending keyword", () => {
    vi.useFakeTimers();
    const previous = vi.fn(),
      latest = vi.fn(),
      filters = createStockFilters();
    const view = render(
      <MultiStockFilters
        cars={stock}
        filters={filters}
        onChange={previous}
        onClear={vi.fn()}
        matchCount={6}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Ford" },
    });
    view.rerender(
      <MultiStockFilters
        cars={stock}
        filters={filters}
        onChange={latest}
        onClear={vi.fn()}
        matchCount={6}
      />,
    );
    act(() => vi.advanceTimersByTime(250));
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith({ search: "Ford" });
  });

  it.each(["sidebar", "chips"])(
    "cancels pending keywords when clearing all filters through %s",
    (location) => {
      vi.useFakeTimers();
      const patch = vi.fn(),
        clear = vi.fn();
      render(
        <Harness initial={{ make: "Ford" }} patch={patch} clear={clear} />,
      );
      fireEvent.change(screen.getByRole("searchbox", { name: "Search cars" }), {
        target: { value: "Fiesta" },
      });
      fireEvent.click(
        location === "sidebar"
          ? within(sidebar()).getByRole("button", { name: "Clear All" })
          : screen.getByRole("button", { name: "Clear all" }),
      );
      act(() => vi.advanceTimersByTime(300));
      expect(clear).toHaveBeenCalledTimes(1);
      expect(patch).not.toHaveBeenCalled();
      expect(state()).toMatchObject({ search: "", make: "" });
      expect(screen.getByRole("searchbox")).toHaveValue("");
    },
  );

  it.each(["input", "chip"])(
    "cancels a pending search through the %s clear control and restores input focus",
    (location) => {
      vi.useFakeTimers();
      const patch = vi.fn();
      render(<Harness initial={{ search: "Ford" }} patch={patch} />);
      const input = screen.getByRole("searchbox");
      fireEvent.change(input, { target: { value: "Fiesta" } });
      fireEvent.click(
        screen.getByRole("button", {
          name:
            location === "input" ? "Clear car search" : "Remove keyword filter",
        }),
      );
      act(() => vi.advanceTimersByTime(300));
      expect(patch).toHaveBeenCalledExactlyOnceWith({ search: "" });
      expect(state().search).toBe("");
      expect(input).toHaveFocus();
    },
  );

  it("does not resurrect a queued keyword after external reset with the same controlled search text", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    render(<Harness patch={patch} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Fiesta" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reset from navigation" }),
    );
    act(() => vi.advanceTimersByTime(300));
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(state().search).toBe("");
  });

  it("accepts external navigation as authoritative while a keyword is pending", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    render(<Harness patch={patch} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Fiesta" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to saved search" }),
    );
    act(() => vi.advanceTimersByTime(300));
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox")).toHaveValue("Yaris");
    expect(state()).toMatchObject({ make: "Toyota", search: "Yaris" });
  });

  it("combines an intentional facet choice with the pending keyword once instead of losing or replaying it", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    render(<Harness patch={patch} />);
    expand("Make");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Focus" },
    });
    fireEvent.click(within(sidebar()).getByRole("checkbox", { name: "Ford" }));
    act(() => vi.advanceTimersByTime(300));
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      make: "Ford",
      search: "Focus",
    });
    expect(state()).toMatchObject({ make: "Ford", search: "Focus" });
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
  });

  it("removes a selected facet chip while carrying a pending keyword through the same patch", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    render(
      <Harness
        initial={{ make: "Ford", transmission: "Automatic" }}
        patch={patch}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Yaris" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove make Ford filter" }),
    );
    act(() => vi.advanceTimersByTime(300));
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      make: "",
      search: "Yaris",
    });
    expect(state()).toMatchObject({
      make: "",
      transmission: "Automatic",
      search: "Yaris",
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 car");
  });

  it("preserves a pending keyword when changing sort and flushes Enter without a later duplicate", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    render(<Harness patch={patch} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Ford" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort cars" }), {
      target: { value: "price-asc" },
    });
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      sort: "price-asc",
      search: "Ford",
    });
    patch.mockClear();
    fireEvent.change(input, { target: { value: "Focus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    act(() => vi.advanceTimersByTime(300));
    expect(patch).toHaveBeenCalledExactlyOnceWith({ search: "Focus" });
  });

  it("does not run the queued search after unmount", () => {
    vi.useFakeTimers();
    const patch = vi.fn();
    const view = render(<Harness patch={patch} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Ford" },
    });
    view.unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("mobile stock drawer", () => {
  const openDrawer = async () => {
    setWidth(390);
    const trigger = screen.getByRole("button", { name: /^Filters(?:,|$)/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Filter cars" });
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );
    return { dialog, trigger };
  };

  it("traps focus, shares controlled selections with the sidebar and restores trigger focus on Escape", async () => {
    render(<Harness />);
    const { dialog, trigger } = await openDrawer();
    expect(dialog).toHaveAccessibleDescription("Results update as you choose.");
    const resultStatus = within(dialog).getByRole("status");
    expect(resultStatus).toHaveAttribute("aria-live", "polite");
    expect(resultStatus).toHaveAttribute("aria-atomic", "true");
    expect(resultStatus).toHaveTextContent("6 cars match your filters.");
    screen.getByTestId("navigation-reset").focus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expand("Make", dialog);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Ford" }));
    expect(resultStatus).toHaveTextContent("2 cars match your filters.");
    expect(
      within(dialog).getByRole("button", { name: "Show 2 cars" }),
    ).toBeEnabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(state().make).toBe("Ford");
    expand("Make, 1 selected");
    expect(
      within(sidebar()).getByRole("checkbox", { name: "Ford" }),
    ).toBeChecked();
  });

  it("keeps Clear filters inside the drawer, updates the live count and shows results after the trap closes", async () => {
    const showResults = vi.fn(() =>
      screen.getByTestId("results-focus").focus(),
    );
    render(<Harness initial={{ make: "Ford" }} showResults={showResults} />);
    const { dialog } = await openDrawer();
    expect(within(dialog).getAllByRole('heading')).toHaveLength(1);
    expect(within(dialog).getByRole('heading', { name: 'Filter cars' })).toBeVisible();
    expect(within(dialog).getAllByRole('button', { name: /Clear filters|Clear All|Clear all|Reset/ })).toHaveLength(1);
    expect(within(dialog).getByRole('region', { name: 'Your selected filters' })).toHaveTextContent('Ford');
    expect(
      within(dialog).getByRole("button", { name: "Show 2 cars" }),
    ).toBeEnabled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear filters" }),
    );
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Show 6 cars" }),
    ).toBeEnabled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show 6 cars" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(showResults).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("results-focus")).toHaveFocus();
    expect(state().make).toBe("");
  });

  it('removes selected filters from inside the drawer without closing it or losing focus to the page', async () => {
    render(<Harness initial={{ make: 'Ford', maxPrice: '9000', search: 'Ford' }} />);
    const { dialog } = await openDrawer();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove maximum price filter' }));
    expect(state()).toMatchObject({ make: 'Ford', maxPrice: '', search: 'Ford' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove keyword filter' }));
    expect(state()).toMatchObject({ make: 'Ford', search: '' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Show 2 cars' })).toBeEnabled();
  });

  it("defaults to trigger focus when Show results has no focus/scroll callback", async () => {
    render(<Harness />);
    const { dialog, trigger } = await openDrawer();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show 6 cars" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("dismisses through the real Radix backdrop without applying a second state or invoking Show results", async () => {
    const showResults = vi.fn();
    render(<Harness showResults={showResults} />);
    const { trigger } = await openDrawer();
    // DismissableLayer registers its outside-pointer listener on the next task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector<HTMLDivElement>(
      'div[data-state="open"].fixed.inset-0',
    );
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay!, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(overlay!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(showResults).not.toHaveBeenCalled();
    expect(state()).toEqual(createStockFilters());
  });

  it("closes at the desktop breakpoint and focuses visible search instead of a hidden mobile trigger", async () => {
    render(<Harness />);
    await openDrawer();
    setWidth(1024);
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());
  });
});


it('searches long make lists and keeps selected values visible after the section is folded',()=>{
  const cars=Array.from({length:12},(_,index)=>car(String(index),{make:`Make ${index}`,model:`Model ${index}`}));
  render(<Harness cars={cars}/>);
  fireEvent.click(screen.getByRole('button',{name:'Make'}));
  const input=screen.getByRole('searchbox',{name:'Search make options'});
  fireEvent.change(input,{target:{value:'Make 11'}});
  expect(screen.queryByRole('checkbox',{name:'Make 0'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:'Make 11'}));
  const toggle=screen.getByRole('button',{name:'Make, 1 selected'});
  expect(toggle).toHaveTextContent('Make 11');
  fireEvent.click(toggle);expect(toggle).toHaveAttribute('aria-expanded','false');
  fireEvent.click(toggle);fireEvent.change(input,{target:{value:''}});
  expect(screen.getByRole('checkbox',{name:'Make 11'})).toBeChecked();
  expect(screen.queryByRole('button',{name:'Vehicle Type'})).not.toBeInTheDocument();
});
