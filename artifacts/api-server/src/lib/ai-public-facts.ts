import { redactAiText } from "./ai-assistance";
const text = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : null;
export function publicAiCar(car: Record<string, any>, compact = false) {
  const extras = car.sourceExtras ?? {},
    spec = car.specifications ?? {};
  const features =
    [car.features, spec.features, extras.features, extras.featureList].find(
      Array.isArray,
    ) ?? [];
  return {
    id: car.id,
    registration: car.vrm ?? car.plate ?? car.registration,
    make: car.make,
    model: car.model,
    variant: car.variant,
    year: car.year,
    price: car.price,
    currency: car.currency,
    mileage: car.mileage,
    transmission: car.transmission,
    fuel: car.fuel,
    engineSize: car.engineSize,
    doors: car.doors,
    seats: car.seats,
    colour: car.colour,
    owners: car.owners,
    inventoryStatus: car.inventoryStatus,
    description: text(
      car.description ??
        spec.description ??
        extras.description ??
        extras.advertDescription,
      compact ? 220 : 6500,
    ),
    features: features
      .filter((f: unknown) => typeof f === "string")
      .slice(0, compact ? 16 : 70)
      .map((f: string) => f.slice(0, 120)),
    writeOffCategory: car.writeOffCategory,
    serviceHistory: text(
      car.serviceHistory ?? spec.serviceHistory ?? extras.serviceHistory,
    ),
    numberOfKeys: car.numberOfKeys ?? extras.numberOfKeys ?? null,
  };
}
export function publicAiDealer(config: Record<string, any>) {
  return {
    identity: { name: text(config.identity?.name, 150) },
    address: config.address
      ? {
          street: config.address.street,
          city: config.address.city,
          region: config.address.region,
          postcode: config.address.postcode,
        }
      : null,
    hours: config.hours,
    contact: config.contact
      ? {
          phone: config.contact.phone,
          whatsapp: config.contact.whatsapp,
          email: config.contact.email,
        }
      : null,
    warranty: config.warranty,
    delivery: config.delivery,
    deliveryPricing: config.deliveryPricing,
    partExchange: config.partExchange,
    testDriveBooking: config.testDriveBooking
      ? {
          enabled: config.testDriveBooking.enabled,
          confirmationMode: config.testDriveBooking.confirmationMode,
          instructions: text(config.testDriveBooking.instructions, 500),
        }
      : null,
  };
}
/** A final hard check prevents AI from returning unavailable/out-of-budget cars. */
export function verifiedAiMatches(
  ids: string[],
  cars: Record<string, any>[],
  question: string,
) {
  const price = question.match(
    /(?:under|below|up to|max(?:imum)?(?: budget)?(?: of)?)\s*£?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i,
  );
  const budget = price
    ? Number(price[1].replace(/,/g, "")) * (price[2] ? 1000 : 1)
    : null;
  const preference = (word: string) => {
    const mentions = [...question.matchAll(new RegExp(`\\b${word}\\b`, "gi"))];
    return mentions.map((m) =>
      /\b(?:no|not|without|avoid)(?:\s+(?:a|an|any|want|wanting))?\s*$/i.test(
        question.slice(Math.max(0, m.index! - 30), m.index),
      )
        ? -1
        : 1,
    );
  };
  return [...new Set(ids)].filter((id) => {
    const car = cars.find((c) => c.id === id);
    if (!car || car.inventoryStatus !== "available") return false;
    if (
      budget != null &&
      (!(car.price > 0) ||
        car.price > budget ||
        (/under|below/i.test(price![0]) && car.price === budget))
    )
      return false;
    for (const [word, pattern] of [
      ["automatic", /auto/i],
      ["manual", /manual/i],
    ] as const) {
      const wanted = preference(word);
      if (wanted.includes(1) && !pattern.test(car.transmission ?? ""))
        return false;
      if (wanted.includes(-1) && pattern.test(car.transmission ?? ""))
        return false;
    }
    const positiveFuels = ["petrol", "diesel", "electric", "hybrid"].filter(
      (fuel) => preference(fuel).includes(1),
    );
    for (const fuel of ["petrol", "diesel", "electric", "hybrid"])
      if (
        preference(fuel).includes(-1) &&
        new RegExp(fuel, "i").test(car.fuel ?? "")
      )
        return false;
    if (positiveFuels.length) {
      const matches = positiveFuels.map((fuel) =>
        new RegExp(fuel, "i").test(car.fuel ?? ""),
      );
      if (
        /\b(?:or|either)\b/i.test(question)
          ? !matches.some(Boolean)
          : !matches.every(Boolean)
      )
        return false;
    }
    for (const [word, pattern] of [
      ["camera", /\b(?:reverse|reversing|rear[ -]view|360)\s+camera\b/i],
      ["heated seats", /heated\s+(?:(?:front|rear|leather)\s+)*seats/i],
      ["parking sensors", /parking\s+sensors/i],
    ] as const) {
      if (question.toLowerCase().includes(word)) {
        const values = [car.description, ...(car.features ?? [])]
          .filter((x): x is string => typeof x === "string")
          .flatMap((x) => x.split(/[.!?;\n]/));
        if (
          !values.some(
            (value) =>
              pattern.test(value) &&
              !/\b(?:no|not|without|missing|broken|faulty|preparation|optional)\b/i.test(
                value,
              ),
          )
        )
          return false;
      }
    }
    return true;
  });
}
export { redactAiText };
export function publicAiMot(history: any, registration: string) {
  if (
    !history ||
    typeof history.registration !== "string" ||
    history.registration.replace(/\s/g, "").toUpperCase() !==
      registration.replace(/\s/g, "").toUpperCase() ||
    !Array.isArray(history.tests)
  )
    return null;
  const latest = [...history.tests].sort(
    (a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate),
  )[0];
  return {
    checkedAt: history.checkedAt,
    firstMotDueDate: history.firstMotDueDate ?? null,
    latest: latest
      ? {
          completedDate: latest.completedDate,
          result: latest.result,
          expiryDate: latest.expiryDate,
          advisories:
            latest.defects
              ?.filter((d: any) => d.type === "ADVISORY")
              .map((d: any) => d.text) ?? [],
        }
      : null,
  };
}
