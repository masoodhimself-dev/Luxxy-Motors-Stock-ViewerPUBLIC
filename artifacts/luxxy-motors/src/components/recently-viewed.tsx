import {
  responsiveVehicleImage,
  retryOriginalImage,
} from "@/lib/responsive-vehicle-image";
import { useState } from "react";
import { Link } from "wouter";
import { useStock } from "@/lib/stock-context";
import {
  clearRecentVehicles,
  recentVehicles,
} from "@/lib/customer-convenience";
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from "@/lib/utils";
export function RecentlyViewed() {
  const { stock } = useStock();
  const [ids, setIds] = useState(recentVehicles);
  const cars = ids
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car) => Boolean(car))
    .slice(0, 4);
  if (!cars.length) return null;
  return (
    <section
      className="container mx-auto border-t border-border px-4 py-7 sm:px-6 lg:px-8"
      aria-labelledby="recent-vehicles-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="recent-vehicles-heading" className="text-lg font-semibold">
          Recently viewed
        </h2>
        <button
          type="button"
          className="text-link min-h-11 text-xs"
          onClick={() => {
            clearRecentVehicles();
            setIds([]);
          }}
        >
          Clear viewing history
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        On this device only, for up to 30 days.
      </p>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cars.map(
          (car) =>
            car && (
              <li key={car.id}>
                <Link
                  href={`/vehicle/${encodeURIComponent(car.id)}`}
                  className="flex min-h-20 items-center gap-3 border-b border-border pb-3"
                >
                  <img
                    src={getThumbnailUrl(car)}
                    {...responsiveVehicleImage(getThumbnailUrl(car), "100px")}
                    onError={(event) => {
                      retryOriginalImage(event.currentTarget);
                    }}
                    alt=""
                    width={100}
                    height={75}
                    loading="lazy"
                    decoding="async"
                    className="h-[75px] w-[100px] shrink-0 bg-muted object-cover"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">
                      {vehicleDisplayTitle(car)}
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      {car.price != null
                        ? formatPrice(car.price, car.currency)
                        : "Price on application"}
                    </span>
                  </span>
                </Link>
              </li>
            ),
        )}
      </ul>
    </section>
  );
}
