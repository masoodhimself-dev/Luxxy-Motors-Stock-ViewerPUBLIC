import type { Car } from "@/lib/stock-context";
import type { StockFilters } from "@/features/stock-search/types";
import { stockRecoverySuggestions } from "@/features/stock-search/recovery";
import { Button } from "./ui/button";
import "./public-search-improvements.css";

export function StockSearchRecovery({
  cars,
  filters,
  onChange,
}: {
  cars: Car[];
  filters: StockFilters;
  onChange: (patch: Partial<StockFilters>) => void;
}) {
  const suggestions = stockRecoverySuggestions(cars, filters);
  if (!suggestions.length) return null;
  return (
    <div className="stock-search-recovery" aria-label="Ways to find more cars">
      {suggestions.map(({ label, patch, count }) => (
        <Button
          key={label}
          variant="outline"
          onClick={() => onChange({ ...patch, page: 1 })}
        >
          {label}
          <span>
            {count} {count === 1 ? "car" : "cars"}
          </span>
        </Button>
      ))}
    </div>
  );
}
