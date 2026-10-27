/** Read-only compatibility for retained published descriptions and disclosures. */

export type DescriptionVehicle = Record<string, unknown>;
export type DescriptionContext = {
  placement: "inline" | "separate";
  tax?: { annualPence: number; checkedAt: string; sourceUrl: string };
};
export function verifiedTax(context?: DescriptionContext, now = new Date()) {
  const tax = context?.tax;
  if (!tax || !Number.isInteger(tax.annualPence) || tax.annualPence < 0)
    return null;
  const checked = Date.parse(tax.checkedAt),
    age = now.getTime() - checked;
  // Recheck source rates regularly and stop using this verified 2026/27 DD rule
  // at the tax-year boundary. No guessed vehicle band or list-price supplement.
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > 30 * 86400000 ||
    now >= new Date("2027-04-01T00:00:00+01:00")
  )
    return null;
  return {
    annualPence: tax.annualPence,
    monthlyPence:
      tax.annualPence === 0 ? null : Math.round((tax.annualPence * 105) / 1200),
    checkedAt: tax.checkedAt,
    sourceUrl: tax.sourceUrl,
    surchargePercent: 5,
    estimate: true,
  };
}
export function taxDescription(context?: DescriptionContext) {
  const tax = verifiedTax(context);
  if (!tax) return null;
  const money = (pence: number) =>
    (pence / 100).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
    });
  return `Vehicle tax: ${money(tax.annualPence)} a year${tax.monthlyPence === null ? "" : `, or approximately ${money(tax.monthlyPence)} a month by Direct Debit, including the 5% surcharge`}. Rate checked ${new Date(tax.checkedAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}. DVLA confirms the final amount and instalments.`;
}
export type DescriptionMetadata = {
  context?: DescriptionContext;
  publishedContext?: DescriptionContext;
  publishedBody?: string;
  firstOriginals?: string[];
  publishedOriginals?: string[];
  publishedAt?: string;
  publishedBy?: string;
  originalWebsiteDescription?: string | null;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
export function descriptionMetadata(
  vehicle: DescriptionVehicle,
): DescriptionMetadata {
  return object(
    object(vehicle.auditMetadata).vehicleDescription,
  ) as DescriptionMetadata;
}
export function originalDescriptions(vehicle: DescriptionVehicle): string[] {
  const raw = object(vehicle.rawSourceData),
    specifications = object(raw.specifications),
    extras = object(raw.sourceExtras);
  return [
    ...new Set(
      [
        raw.description,
        specifications.description,
        extras.descriptionOrigin === "generated-facts"
          ? ""
          : extras.description,
        extras.advertDescription,
      ]
        .map(text)
        .filter(Boolean),
    ),
  ];
}
export function retainedOriginals(vehicle: DescriptionVehicle): string[] {
  const meta = descriptionMetadata(vehicle);
  return [
    ...new Set([
      ...(meta.firstOriginals ??
        (text(vehicle.websiteDescription)
          ? [text(vehicle.websiteDescription)]
          : [])),
      ...(meta.publishedOriginals ?? []),
      ...originalDescriptions(vehicle),
    ]),
  ];
}
// Preserve complete source sentences, including negations. The full source advert is
// retained separately as well: this pattern is a prominence aid, not a classifier.
export function descriptionDisclosures(vehicle: DescriptionVehicle): string[] {
  const raw = object(vehicle.rawSourceData),
    extras = object(raw.sourceExtras);
  const notes = [
    ...retainedOriginals(vehicle),
    ...descriptionFeatures(vehicle).filter((feature) =>
      /\b(?:faulty|broken|inoperative|damaged|missing|removed|not working|does(?:n['’]?t| not) work|no (?:service|warranty|mot))\b/i.test(
        feature,
      ),
    ),
  ]
    .flatMap((value) => value.split(/(?<=[.!?])\s+|\n+/))
    .map((value) => value.trim())
    .filter((value) =>
      /\b(?:cat(?:egory)?\.?\s*[-:]?\s*[abcdns]\b|write[ -]?off|accident|crash|damage|repair|salvage|fault|defect|warning|broken|inoperative|dent|scratch|rust|corrosion|leak|slipping|missing|not working|does(?:n['’]?t| not) work|no (?:service|warranty|mot)|history|mileage (?:discrepancy|not|incorrect)|spares|trade sale|export only|recall|finance outstanding|stolen|flood|fire|non[ -]?runner)\b/i.test(
        value,
      ),
    );
  if (
    text(extras.serviceHistory) &&
    !/^(?:service history|unknown|not (?:supplied|provided|known)|n\/?a)$/i.test(
      text(extras.serviceHistory),
    )
  )
    notes.push(`Recorded service history: ${text(extras.serviceHistory)}.`);
  if (text(vehicle.writeOffCategory))
    notes.push(
      `Recorded write-off category: ${text(vehicle.writeOffCategory)}.`,
    );
  return [...new Set(notes)];
}
function descriptionFeatures(vehicle: DescriptionVehicle): string[] {
  const raw = object(vehicle.rawSourceData),
    specs = object(raw.specifications),
    extras = object(raw.sourceExtras);
  return [
    ...new Set(
      [
        raw.features,
        specs.features,
        extras.features,
        extras.featureList,
      ].flatMap((value) =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [],
      ),
    ),
  ];
}
export function publishedDescription(
  body: string,
  vehicle: DescriptionVehicle,
) {
  const notes = descriptionDisclosures(vehicle).filter(
    (note) => !body.toLowerCase().includes(note.toLowerCase()),
  );
  return [
    body,
    notes.length ? `Important information\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
