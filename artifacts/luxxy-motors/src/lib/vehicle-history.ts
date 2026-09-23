/** Interpret supplied history only; a missing category is not a history check. */
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
