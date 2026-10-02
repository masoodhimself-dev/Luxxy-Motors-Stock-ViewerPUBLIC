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

function bookingDraftHasValidShape(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const booking = value as Record<string, unknown>;
  return typeof booking.enabled === 'boolean'
    && ['durationMinutes', 'bufferMinutes', 'minimumNoticeHours', 'dailyCapacity', 'daysAhead'].every((field) => typeof booking[field] === 'number' && Number.isFinite(booking[field]))
    && typeof booking.instructions === 'string'
    && ['instant', 'approval'].includes(String(booking.confirmationMode))
    && Array.isArray(booking.blockedDates) && booking.blockedDates.every((date) => typeof date === 'string')
    && Array.isArray(booking.weeklyHours) && booking.weeklyHours.length === 7
    && booking.weeklyHours.every((hours) => hours && typeof hours === 'object' && Number.isInteger(hours.day) && hours.day >= 0 && hours.day <= 6 && typeof hours.enabled === 'boolean' && typeof hours.open === 'string' && typeof hours.close === 'string')
    && new Set(booking.weeklyHours.map((hours) => hours.day)).size === 7;
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
  if (draft.form && typeof draft.form === 'object' && draft.form.brochure === undefined && saved.brochure !== undefined) {
    draft = { ...draft, form: { ...draft.form, brochure: { ...saved.brochure } } };
  }
  if (draft.form && typeof draft.form === 'object' && draft.form.testDriveBooking === undefined && saved.testDriveBooking !== undefined) {
    draft = { ...draft, form: { ...draft.form, testDriveBooking: { ...saved.testDriveBooking, blockedDates: [...saved.testDriveBooking.blockedDates], weeklyHours: saved.testDriveBooking.weeklyHours.map((hours) => ({ ...hours })) } } };
  }
  if (typeof draft.saved !== 'string' || !matchesShape(draft.form, saved)) return null;
  if (!bookingDraftHasValidShape(draft.form.testDriveBooking)) return null;
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
