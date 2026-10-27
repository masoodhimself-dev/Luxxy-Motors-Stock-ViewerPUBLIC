export const dealerFeatureDefinitions = [
  { key: 'publicEnquiries', label: 'Website enquiries', description: 'New general website enquiries and callback requests.', defaultEnabled: true },
  { key: 'partExchange', label: 'Part exchange', description: 'New website part-exchange requests. Existing records remain available.', defaultEnabled: true },
  { key: 'testDriveBookings', label: 'Test-drive bookings', description: 'New booking requests, confirmations and rescheduling.', defaultEnabled: true },
  { key: 'testDriveDeclarations', label: 'Test-drive declarations', description: 'Create declaration links and accept new customer signatures.', defaultEnabled: true },
  { key: 'customerEmails', label: 'Customer email delivery', description: 'Send new customer emails and retry queued emails. History remains available.', defaultEnabled: true },
] as const;
export type DealerFeatureKey = typeof dealerFeatureDefinitions[number]['key'];
export type FeatureMode = 'inherit' | 'enabled' | 'disabled';
export type FeatureRule = { mode: FeatureMode; disabledAt: string | null; revision: number; reason: string; updatedAt: string | null; updatedBy: string | null };
export type DealerFeatureState = {
  key: DealerFeatureKey; label: string; description: string; releaseEnabled: boolean;
  enabled: boolean; inheritedEnabled: boolean; rule: FeatureRule; platformRule: FeatureRule;
};
export const defaultFeatureRule = (mode: FeatureMode): FeatureRule => ({ mode, disabledAt: null, revision: 0, reason: '', updatedAt: null, updatedBy: null });
export function resolveDealerFeatures(defaults: Partial<Record<DealerFeatureKey, FeatureRule>>, overrides: Partial<Record<DealerFeatureKey, FeatureRule>>, now = new Date()): DealerFeatureState[] {
  return dealerFeatureDefinitions.map(definition => {
    const releaseEnabled = true;
    const platformRule = defaults[definition.key] ?? defaultFeatureRule(definition.defaultEnabled ? 'enabled' : 'disabled');
    const rule = overrides[definition.key] ?? defaultFeatureRule('inherit');
    const expired = (value: FeatureRule) => value.disabledAt !== null && Date.parse(value.disabledAt) <= now.getTime();
    const inheritedEnabled = releaseEnabled && platformRule.mode === 'enabled' && !expired(platformRule);
    const enabled = releaseEnabled && !expired(rule) && (rule.mode === 'inherit' ? inheritedEnabled : rule.mode === 'enabled');
    return { ...definition, releaseEnabled, enabled, inheritedEnabled, rule, platformRule };
  });
}
