import type { Car } from "./stock-context";
/** Display supplied stock fields only. Missing records never imply a clean history or included cover. */
export function buyerInformation(car: Car) {
  const sources = [car, car.specifications, car.sourceExtras];
  const text = (keys: string[]) => {
    for (const source of sources)
      for (const key of keys) {
        const value = source?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (
          Array.isArray(value) &&
          value.every((item) => typeof item === "string")
        )
          return value.filter(Boolean).join(" · ") || null;
      }
    return null;
  };
  let keyCount: string | null = null;
  for (const source of sources) {
    const value = source?.numberOfKeys ?? source?.keyCount;
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 20
    ) {
      keyCount = `${value} ${value === 1 ? "key" : "keys"}`;
      break;
    }
  }
  const history = text(["writeOffCategory"]);
  const category = history?.match(/^(?:cat(?:egory)?\s*)?([SN])$/i)?.[1]?.toUpperCase();
  return [
    { label: "Service history", value: text(["serviceHistory"]) },
    { label: "MOT expiry", value: text(["motExpiry", "motExpiryDate"]) },
    { label: "Keys", value: keyCount || text(["keys"]) },
    { label: "Insurance history", value: category ? `Category ${category} recorded` : history },
    { label: "Condition", value: text(["conditionNotes", "condition"]) },
    { label: "Warranty", value: text(["warrantyDetails", "warranty"]) },
    {
      label: "Included with this car",
      value: text(["includedItems", "includedWithVehicle"]),
    },
  ];
}
