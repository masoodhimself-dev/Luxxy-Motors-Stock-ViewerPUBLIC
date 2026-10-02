import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewSettings } from '../../preview/settings';
import { clearSettingsDraft, readSettingsDraft, writeSettingsDraft } from './settings-draft';
import type { DealerTestDriveBooking } from '@workspace/api-client-react';

const bookingSettings: DealerTestDriveBooking = {
  enabled: true, durationMinutes: 30, bufferMinutes: 15, minimumNoticeHours: 2,
  dailyCapacity: 8, daysAhead: 30, blockedDates: ['2026-12-25'], instructions: 'Bring your driving licence.', confirmationMode: 'approval',
  weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: day !== 0, open: '09:00', close: '17:00' })),
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearSettingsDraft(); });

describe('unpublished showroom drafts', () => {
  it('retains changes with their published baseline and clears them explicitly', () => {
    const baseline = JSON.stringify(previewSettings);
    const form = structuredClone(previewSettings);
    form.identity.name = 'Unpublished name';
    expect(writeSettingsDraft(baseline, form)).toBe(true);
    expect(readSettingsDraft(previewSettings)).toMatchObject({ saved: baseline, form });
    clearSettingsDraft();
    expect(readSettingsDraft(previewSettings)).toBeNull();
  });
  it('rejects expired drafts and corrupted nested fields', () => {
    writeSettingsDraft('{}', previewSettings);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 86_400_001);
    expect(readSettingsDraft(previewSettings)).toBeNull();
    vi.restoreAllMocks();
    clearSettingsDraft();
    sessionStorage.setItem('luxxy-showroom-draft-v1', JSON.stringify({ saved: '{}', updatedAt: Date.now(), form: { ...previewSettings, identity: { ...previewSettings.identity, name: {} } } }));
    expect(readSettingsDraft(previewSettings)).toBeNull();
  });
  it('keeps an in-memory draft when browser storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      setItem: () => { throw new Error('Storage disabled'); },
      getItem: () => { throw new Error('Storage disabled'); },
    });
    expect(writeSettingsDraft('{}', previewSettings)).toBe(false);
    expect(readSettingsDraft(previewSettings)?.form.identity.name).toBe(previewSettings.identity.name);
  });
  it('retains old unpublished drafts and inherits the current reservation settings', () => {
    const form = structuredClone(previewSettings);
    delete form.onlineReservation;
    form.identity.name = 'Older unpublished name';
    writeSettingsDraft('{}', form);
    const restored = readSettingsDraft(previewSettings);
    expect(restored?.form.identity.name).toBe('Older unpublished name');
    expect(restored?.form.onlineReservation).toEqual(previewSettings.onlineReservation);
  });
  it('retains old drafts when optional brochure settings are introduced', () => {
    const form = structuredClone(previewSettings);
    form.identity.name = 'Draft dealership';
    writeSettingsDraft('{}', form);
    const restored = readSettingsDraft({...previewSettings,brochure:{title:'Saved brochure'}});
    expect(restored?.form.identity.name).toBe('Draft dealership');
    expect(restored?.form.brochure?.title).toBe('Saved brochure');
  });

  it('inherits booking settings into older drafts without sharing nested fields', () => {
    const form = structuredClone(previewSettings);
    delete form.testDriveBooking;
    form.identity.name = 'Older booking draft';
    writeSettingsDraft('{}', form);
    const saved = { ...previewSettings, testDriveBooking: bookingSettings };
    const restored = readSettingsDraft(saved);
    expect(restored?.form.identity.name).toBe('Older booking draft');
    expect(restored?.form.testDriveBooking).toEqual(bookingSettings);
    expect(restored?.form.testDriveBooking?.weeklyHours[0]).not.toBe(bookingSettings.weeklyHours[0]);
    expect(restored?.form.testDriveBooking?.blockedDates).not.toBe(bookingSettings.blockedDates);
  });

  it('retains unpublished booking edits even when the saved settings have no booking policy', () => {
    const saved = structuredClone(previewSettings);
    delete saved.testDriveBooking;
    writeSettingsDraft('{}', { ...saved, testDriveBooking: bookingSettings });
    expect(readSettingsDraft(saved)?.form.testDriveBooking).toEqual(bookingSettings);
  });

  it.each([
    { ...bookingSettings, weeklyHours: {} },
    { ...bookingSettings, dailyCapacity: 'eight' },
    { ...bookingSettings, confirmationMode: 'always' },
    { ...bookingSettings, blockedDates: [42] },
    { ...bookingSettings, weeklyHours: bookingSettings.weeklyHours.map((hours) => ({ ...hours, day: 0 })) },
  ])('rejects corrupt optional booking policy data %#', (testDriveBooking) => {
    const saved = structuredClone(previewSettings);
    delete saved.testDriveBooking;
    sessionStorage.setItem('luxxy-showroom-draft-v1', JSON.stringify({ saved: '{}', updatedAt: Date.now(), form: { ...saved, testDriveBooking } }));
    expect(readSettingsDraft(saved)).toBeNull();
  });

});
