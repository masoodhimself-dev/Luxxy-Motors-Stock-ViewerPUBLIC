import type { DealerSettings } from '@workspace/api-client-react';

const key = 'luxxy-showroom-draft-v1';
type Draft = { saved: string; form: DealerSettings; updatedAt: number };
let memoryDraft: Draft | null = null;

function matchesShape(value: unknown, example: unknown): boolean {
  if (example == null) return true;
  if (Array.isArray(example)) return Array.isArray(value) && value.every((item) => !example.length || matchesShape(item, example[0]));
  if (typeof example === 'object') return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.entries(example).every(([name, field]) => matchesShape((value as Record<string, unknown>)[name], field)));
  return typeof value === typeof example;
}

// Unpublished dealership settings only: kept in this tab, never customer data.
export function readSettingsDraft(saved: DealerSettings): Draft | null {
  let draft: Draft | null = memoryDraft;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) draft = JSON.parse(raw);
  } catch { /* Storage may be disabled; retain the in-memory draft. */ }
  if (!draft || !Number.isFinite(draft.updatedAt) || Date.now() - draft.updatedAt > 86_400_000) return null;
  // Retain unpublished changes made before online-reservation settings existed.
  if (draft.form && typeof draft.form === 'object' && !Array.isArray(draft.form) && draft.form.onlineReservation === undefined && saved.onlineReservation !== undefined) {
    draft = { ...draft, form: { ...draft.form, onlineReservation: { ...saved.onlineReservation } } };
  }
  if (typeof draft.saved !== 'string' || !matchesShape(draft.form, saved)) return null;
  return draft;
}

export function writeSettingsDraft(saved: string, form: DealerSettings): boolean {
  memoryDraft = { saved, form, updatedAt: Date.now() };
  try {
    sessionStorage.setItem(key, JSON.stringify(memoryDraft));
    return true;
  } catch { return false; }
}

export function clearSettingsDraft() {
  memoryDraft = null;
  try { sessionStorage.removeItem(key); } catch { /* Memory copy is cleared. */ }
}
