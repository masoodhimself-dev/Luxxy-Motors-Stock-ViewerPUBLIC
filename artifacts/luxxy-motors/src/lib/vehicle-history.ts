/** Interpret supplied history only; a missing category is not a history check. */
export function vehicleWriteOffCategory(car: {
  writeOffCategory?: string | null;
  specifications?: Record<string, unknown> | null;
  sourceExtras?: Record<string, unknown> | null;
}): string | null {
  for (const source of [car, car.specifications, car.sourceExtras]) {
    const value = source?.writeOffCategory;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function recordedWriteOffCategory(value?: string | null): 'S' | 'N' | null {
  const category = value?.trim().match(/^(?:cat(?:egory)?\s*[-:]?\s*)?([SN])(?:\s+recorded)?$/i)?.[1];
  return category ? category.toUpperCase() as 'S' | 'N' : null;
}

export function hasExplicitClearHistory(value?: string | null) {
  return /^(?:none|clear|no (?:recorded )?write[ -]?off(?: recorded)?)$/i.test(value?.trim() || '');
}

export function insuranceHistoryLabel(value?: string | null) {
  const category = recordedWriteOffCategory(value);
  if (category) return `Category ${category} recorded`;
  if (hasExplicitClearHistory(value)) return 'No write-off recorded';
  return value?.trim() || 'Not provided';
}

/** Keep an explicit advert disclosure visible without promoting it to a verified history field. */
export function advertisedWriteOffCategory(description?: string | null): 'S' | 'N' | null {
  if (!description) return null;
  // Conflicting clear-history copy needs a staff review, not an inferred badge.
  if (/\bhpi\s+clear\b|\bno\s+(?:recorded\s+)?(?:insurance\s+)?(?:write[ -]?off|accident history)\b|\b(?:not|never)\s+(?:previously\s+)?(?:recorded|classified|registered)\s+as\s+(?:a\s+)?cat(?:egory)?\b/i.test(description)) return null;
  const categories = new Set<'S' | 'N'>();
  for (const sentence of description.match(/[^.!?\n]+[.!?]?/g) ?? []) {
    // Avoid interpreting questions, negated statements, examples or uncertain/contradictory copy.
    if (/\?|\b(?:not|never|no|without|isn['’]?t|wasn['’]?t|hasn['’]?t|isnt|wasnt|hasnt|possibly|possible|may|might|could|whether|if|example|unknown|unconfirmed|incorrect(?:ly)?|mistake|error)\b/i.test(sentence)) continue;
    // Accept a direct statement about this car (or a bare disclosure). Dealer
    // policies, other cars and pronouns with an unclear subject are not evidence.
    const direct = sentence.trim().replace(/^(?:please note|insurance history|history)\s*:\s*/i, '');
    const match = direct.match(/^(?:(?:this|the)\s+(?:car|vehicle)\s+(?:(?:is|was|has been|had been)\s+)?)?(?:previously\s+)?(?:recorded|registered|classified)\s+as\s+(?:a\s+)?cat(?:egory)?\s*[-:]?\s*([SN])\b/i);
    if (match) categories.add(match[1].toUpperCase() as 'S' | 'N');
  }
  return categories.size === 1 ? [...categories][0] : null;
}

export function vehicleInsuranceDisclosure(car: Parameters<typeof vehicleWriteOffCategory>[0], description?: string | null) {
  const category = recordedWriteOffCategory(vehicleWriteOffCategory(car));
  if (category) return {
    category,
    label: `Category ${category}`,
    summary: `Category ${category} · recorded insurance history`,
    cardLabel: `Category ${category} recorded`,
    explanation: `This vehicle previously had ${category === 'S' ? 'structural' : 'non-structural'} damage recorded by an insurer. Ask us for the available repair and inspection records before deciding to buy.`,
  };
  const advertised = advertisedWriteOffCategory(description);
  if (!advertised) return null;
  return {
    category: advertised,
    label: `Advert states Category ${advertised}`,
    summary: `Advert states Category ${advertised} · read the insurance history`,
    cardLabel: `Advert states Category ${advertised}`,
    explanation: `The advert states this car was recorded as Category ${advertised}. Its structured insurance-history field has not confirmed that category. Ask us to confirm the recorded history and provide the available repair and inspection records before deciding to buy.`,
  };
}
