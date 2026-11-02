import { SettingsVersionError } from './settings-versions';

const presentationColours = ['pageColour', 'panelColour', 'headingColour', 'linkColour'] as const;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const owns = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key);

/** Apply inside the locked settings transaction, including when restoring history.
 * Colour omissions are compatible with editors that no longer expose them. */
export function websiteColourPolicy(
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
  options: { allowChanges?: boolean; restoring?: boolean } = {},
): Record<string, unknown> {
  const next = { ...incoming };
  const identity = record(incoming.identity), previousIdentity = record(current.identity);
  if (identity && previousIdentity) {
    const oldColours = record(previousIdentity.brandColors);
    const supplied = record(identity.brandColors);
    const merged = supplied && oldColours ? { ...oldColours, ...supplied } : identity.brandColors;
    if (!options.restoring && !options.allowChanges && owns(identity, 'brandColors') && identity.brandColors !== undefined) {
      if (!supplied || Object.keys({ ...oldColours, ...supplied }).some(key => supplied[key] !== undefined && supplied[key] !== oldColours?.[key]))
        throw new SettingsVersionError('Website colours are managed by the platform and cannot be changed in dealership Settings.', 403);
    }
    const colours = options.restoring || !owns(identity, 'brandColors') || identity.brandColors === undefined
      ? previousIdentity.brandColors : merged;
    next.identity = { ...identity };
    if (colours === undefined) delete (next.identity as Record<string, unknown>).brandColors;
    else (next.identity as Record<string, unknown>).brandColors = colours;
  }
  const presentation = record(incoming.presentation), previousPresentation = record(current.presentation);
  if (presentation || (incoming.presentation === undefined && previousPresentation)) {
    const retained = { ...presentation };
    for (const key of presentationColours) {
      if (!options.restoring && !options.allowChanges && presentation && owns(presentation, key) && presentation[key] !== undefined && presentation[key] !== previousPresentation?.[key])
        throw new SettingsVersionError('Website colours are managed by the platform and cannot be changed in dealership Settings.', 403);
      if (options.restoring || !presentation || !owns(presentation, key) || presentation[key] === undefined) {
        if (previousPresentation && owns(previousPresentation, key)) retained[key] = previousPresentation[key];
        else delete retained[key];
      }
    }
    next.presentation = retained;
  }
  return next;
}

/** Keep promises explicit: do not drop invalid blank/non-string entries silently. */
export function normaliseIncludedItems(incoming: Record<string, unknown>): Record<string, unknown> {
  const presentation = record(incoming.presentation);
  if (!presentation || !Array.isArray(presentation.includedItems)) return incoming;
  const seen = new Set<string>();
  const includedItems = presentation.includedItems.map(item => typeof item === 'string' ? item.trim() : item).filter(item => {
    if (typeof item !== 'string') return true;
    const key = item.toLocaleLowerCase('en-GB');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { ...incoming, presentation: { ...presentation, includedItems } };
}
