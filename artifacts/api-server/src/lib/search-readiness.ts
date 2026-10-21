import { showroomHoursComplete } from '@workspace/vehicle-meta';

type PublishedSettings = {
  identity?: { name?: unknown; logoAsset?: unknown };
  contact?: { phone?: unknown; email?: unknown };
  address?: { street?: unknown; city?: unknown; region?: unknown; postcode?: unknown };
  hours?: unknown;
};
const present = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const sample = (value: unknown) => /\b(?:sample|fictional|placeholder)\b|\bexample(?:\.[a-z]+| road)\b|replace (?:this|these)/i.test(JSON.stringify(value ?? ''));
const settingsLink = (section: string) => `/portal?section=settings&settingsTab=dealership&websiteSection=${section}`;

/** Field presence is not proof of accuracy, indexing, rankings or account ownership. */
export function searchReadiness(settings: PublishedSettings, origin: string, demo = false, now = new Date()) {
  const address = settings.address;
  const hours = Array.isArray(settings.hours) ? settings.hours : [];
  const hoursPresent = !sample(hours) && showroomHoursComplete(hours);
  const checks = [
    { code: 'identity', label: 'Business name', ready: present(settings.identity?.name) && !sample(settings.identity?.name), detail: 'Use the same trading name on your website and business listings.', settingsUrl: '/portal?section=settings&settingsTab=website&websiteSection=identity' },
    { code: 'contact', label: 'Contact details', ready: (present(settings.contact?.phone) || present(settings.contact?.email)) && !sample(settings.contact), detail: 'Publish a customer phone number or email address.', settingsUrl: settingsLink('contact') },
    { code: 'address', label: 'Showroom address', ready: Boolean(present(address?.street) && present(address?.postcode) && (present(address?.city) || present(address?.region))) && !sample(address), detail: 'Confirm that this is the showroom customers can visit.', settingsUrl: settingsLink('contact') },
    { code: 'hours', label: 'Opening hours', ready: hoursPresent, detail: 'Confirm every day, including closed days and any appointment-only arrangements.', settingsUrl: settingsLink('contact') },
  ];
  const canonical = new URL(origin);
  return {
    generatedAt: now.toISOString(), origin: canonical.origin, demonstration: demo,
    status: demo ? 'demo_excluded' as const : checks.every(check => check.ready) ? 'ready_to_submit' as const : 'needs_details' as const,
    sitemapUrl: new URL('/sitemap.xml', canonical).href,
    robotsUrl: new URL('/robots.txt', canonical).href,
    checks,
    externalChecks: { googleIndexing: 'unconfirmed', bingIndexing: 'unconfirmed', businessProfile: 'unconfirmed', firewallCrawlerAccess: 'unconfirmed' },
  };
}
