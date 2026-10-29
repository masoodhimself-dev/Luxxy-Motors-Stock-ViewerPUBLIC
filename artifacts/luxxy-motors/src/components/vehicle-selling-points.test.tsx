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

it("shows only factual ownership, service and ULEZ highlights", () => {
  render(<VehicleSellingPoints car={car()} />);
  const list = screen.getByRole("list", { name: "Vehicle highlights" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(list).toHaveTextContent("ULEZ compliant");
  expect(list).toHaveTextContent("2 owners");
  expect(list).not.toHaveTextContent("£20 road tax per year");
  expect(list).not.toHaveTextContent("Affordable Insurance");
  expect(screen.queryByText("Check this car’s registration before driving in the zone.")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Check with TfL" })).not.toBeInTheDocument();
  expect(list.querySelectorAll("svg")).toHaveLength(3);
});

it("keeps compact cards to three benefits and avoids repeating the mileage fact", () => {
  render(<VehicleSellingPoints car={car()} compact omitMileage />);
  const list = screen.getByRole("list", { name: "Vehicle highlights" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(list).not.toHaveTextContent("Affordable Insurance");
  expect(list).toHaveTextContent("2 owners");
  expect(list).not.toHaveTextContent("below average");
});

it("shows an honest ownership explanation without deriving previous keeper counts", async () => {
  render(<VehicleSellingPoints car={car()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "2 owners" }),
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "ownership count supplied with this vehicle",
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

it("keeps MOT alongside the existing badges and supports MOT without other highlights", () => {
  const { rerender } = render(<VehicleSellingPoints car={car()} motBadge={<button>MOT not required until 05/2028</button>} />);
  const list = screen.getByRole('list', { name: 'Vehicle highlights' });
  expect(within(list).getByRole('button', { name: 'MOT not required until 05/2028' })).toBeInTheDocument();
  expect(list).toHaveTextContent('ULEZ compliant');
  rerender(<VehicleSellingPoints car={{} as Car} motBadge={<button>Long MOT</button>} />);
  expect(screen.getByRole('list', { name: 'Vehicle highlights' })).toHaveTextContent('Long MOT');
});
