import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewSettings } from '../../preview/settings';
import { clearSettingsDraft, readSettingsDraft, writeSettingsDraft } from './settings-draft';

afterEach(() => { vi.restoreAllMocks(); clearSettingsDraft(); });

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
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    expect(writeSettingsDraft('{}', previewSettings)).toBe(false);
    expect(readSettingsDraft(previewSettings)?.form.identity.name).toBe(previewSettings.identity.name);
  });
});
