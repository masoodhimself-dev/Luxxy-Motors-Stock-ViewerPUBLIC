import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Car } from "@/lib/stock-context";
import { VehicleSellingPoints } from "./vehicle-selling-points";

const car = (extra: Partial<Car> = {}) =>
  ({
    fuel: "Diesel",
    emissionClass: "Euro 6",
    mileage: 24000,
    owners: 2,
    sourceExtras: {
      serviceHistory: "Full service history",
      runningCosts: {
        items: [
          { label: "Tax per year", value: "£20" },
          { label: "Insurance group", value: "11E" },
        ],
      },
    },
    ...extra,
  }) as Car;

it("shows all supplied benefits without restoring the removed emissions disclaimer", () => {
  render(<VehicleSellingPoints car={car()} />);
  const list = screen.getByRole("list", { name: "Vehicle highlights" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(6);
  expect(list).toHaveTextContent("ULEZ compliant");
  expect(list).toHaveTextContent("24k miles · low mileage");
  expect(list).toHaveTextContent("£20 road tax per year");
  expect(list).toHaveTextContent("Affordable Insurance");
  expect(screen.queryByText("Check this car’s registration before driving in the zone.")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Check with TfL" })).not.toBeInTheDocument();
  expect(list.querySelectorAll("svg")).toHaveLength(6);
});

it("keeps compact cards to three benefits and avoids repeating the mileage fact", () => {
  render(<VehicleSellingPoints car={car()} compact omitMileage />);
  const list = screen.getByRole("list", { name: "Vehicle highlights" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(list).toHaveTextContent("Affordable Insurance");
  expect(list).not.toHaveTextContent("previous keepers");
  expect(list).not.toHaveTextContent("below average");
});

it("shows the actual annual-tax explanation when a customer taps the fact", async () => {
  render(<VehicleSellingPoints car={car()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "£20 road tax per year" }),
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "confirm the current amount before buying",
  );
});

it("omits the entire benefits area when the required facts are absent", () => {
  const { container } = render(
    <VehicleSellingPoints
      car={car({
        fuel: null,
        emissionClass: null,
        mileage: null,
        owners: null,
        sourceExtras: null,
      })}
    />,
  );
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole("link", { name: /TfL/ })).not.toBeInTheDocument();
});
