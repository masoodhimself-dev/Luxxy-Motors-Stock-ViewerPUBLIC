import type { DealerSettings } from '@workspace/api-client-react';
import { websiteFields } from './website-content';
import { websiteTemplates, resolveWebsiteTemplate } from './website-templates';

export type SettingsChange = {
  path: string;
  group: 'Dealership details' | 'Website' | 'Bookings';
  label: string;
  section: string;
  published: string;
  draft: string;
};
const labels: Record<string, string> = {
  'presentation.websiteTemplate':'Website template',
  'identity.name':'Dealership name', 'identity.logoText':'Logo text', 'identity.logoAsset':'Header logo',
  'identity.brandColors.primaryHsl':'Primary brand colour', 'identity.brandColors.accentHsl':'Accent brand colour',
  'contact.phone':'Public phone number', 'contact.whatsapp':'Public WhatsApp number', 'contact.email':'Public email', 'contact.googleReviewUrl':'Google review request link',
  'address.street':'Street address', 'address.city':'Town / city', 'address.region':'Region', 'address.postcode':'Postcode', 'address.mapsUrl':'Directions link',
  'hours':'Showroom opening hours', 'featuredVehicleIds':'Featured vehicles and order', 'trustItems':'Short selling points', 'whyBuy':'Selling points',
  'hero.announcement':'Homepage announcement', 'hero.copy':'Homepage headline', 'hero.subcopy':'Dealership introduction', 'hero.primaryCta':'Browse cars button', 'hero.secondaryCta':'Secondary homepage button',
  'bookViewing.ctaLabel':'Test-drive button label', 'bookViewing.title':'Legacy test-drive title', 'bookViewing.description':'Legacy test-drive description',
  'legal.companyName':'Registered company name', 'legal.companyNumber':'Company number', 'legal.vatNumber':'VAT number', 'legal.termsUrl':'Terms link', 'legal.privacyUrl':'Privacy link', 'legal.cookieUrl':'Cookie link',
  'social.instagram':'Instagram', 'social.facebook':'Facebook', 'social.twitter':'X / Twitter',
  'presentation.reviews':'Customer reviews', 'presentation.reviewsEnabled':'Show customer reviews', 'presentation.reviewsUrl':'Read all reviews link',
  'presentation.featuredEnabled':'Show featured cars', 'presentation.visitEnabled':'Show visit and dealership section', 'presentation.servicesEnabled':'Show homepage services', 'presentation.showHeroDescription':'Show homepage introduction',
  'presentation.heroImageUrl':'Homepage photograph', 'presentation.heroImageAlt':'Homepage photograph description', 'presentation.heroImagePosition':'Homepage photograph focus',
  'presentation.teamImageUrl':'Team photograph', 'presentation.teamImageAlt':'Team photograph description', 'presentation.teamIntroduction':'Team introduction',
  'presentation.visitInstructions':'Appointments & visiting', 'presentation.parkingInstructions':'Parking & arrival instructions', 'presentation.includedInformation':'Buying & handover information',
  'presentation.footerLogoUrl':'Dark header / footer logo', 'presentation.faviconUrl':'Browser-tab icon',
  'presentation.pageColour':'Page background', 'presentation.panelColour':'Cards and forms colour', 'presentation.headingColour':'Headings and prices colour', 'presentation.linkColour':'Links and accents colour',
  'brochure.useWebsiteColour':'Use website colour for vehicle sheets', 'brochure.accentColour':'Vehicle-sheet print colour', 'brochure.footerNote':'Vehicle-sheet closing note',
  'testDriveBooking.enabled':'Accept online test-drive bookings', 'testDriveBooking.confirmationMode':'Booking confirmation', 'testDriveBooking.durationMinutes':'Appointment length (minutes)',
  'testDriveBooking.bufferMinutes':'Time between visits (minutes)', 'testDriveBooking.minimumNoticeHours':'Advance notice (hours)', 'testDriveBooking.dailyCapacity':'Maximum appointments per day',
  'testDriveBooking.daysAhead':'Booking window (days)', 'testDriveBooking.weeklyHours':'Appointment hours', 'testDriveBooking.blockedDates':'Unavailable appointment dates', 'testDriveBooking.instructions':'Booking instructions',
};
const readableName = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
const weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function labelFor(path: string) {
  if (labels[path]) return labels[path];
  const key = path.replace('presentation.websiteCopy.', '');
  if (path.startsWith('presentation.websiteCopy.')) return `Page wording: ${websiteFields.find(field => field.key === key)?.label ?? readableName(key)}`;
  const [group, field] = path.split('.');
  if (['warranty','delivery','partExchange'].includes(group)) return `${group === 'partExchange' ? 'Part exchange' : readableName(group)} ${field === 'ctaLabel' ? 'button label' : readableName(field).toLowerCase()}`;
  return path.split('.').map(readableName).join(' · ');
}
function sectionFor(path: string): string {
  if (path === 'presentation.websiteTemplate') return 'homepage';
  const [group, field] = path.split('.');
  if (group === 'testDriveBooking') return 'bookings';
  if (['contact','address','hours'].includes(group)) return 'contact';
  if (['legal','social'].includes(group)) return 'legal';
  if (group === 'identity' || (group === 'presentation' && ['pageColour','panelColour','headingColour','linkColour','footerLogoUrl','faviconUrl'].includes(field))) return 'identity';
  if (group === 'brochure') return 'brochure';
  if (['warranty','delivery','partExchange','onlineReservation'].includes(group)) return 'services';
  if (['trustItems','whyBuy'].includes(group)) return 'proof';
  if (path.startsWith('presentation.websiteCopy.')) return 'pages';
  if (group === 'presentation' && !['featuredEnabled','visitEnabled','servicesEnabled','showHeroDescription'].includes(field)) return 'presentation';
  return 'homepage';
}
function flatten(value: unknown, prefix = '', result: Record<string, unknown> = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, result);
  } else result[prefix] = value;
  return result;
}
function display(value: unknown, path: string, vehicleNames: Readonly<Record<string,string>>): string {
  if (path === 'presentation.websiteTemplate') return websiteTemplates.find(template => template.id === resolveWebsiteTemplate(value))!.name;
  if (value === undefined || value === null || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (path === 'testDriveBooking.confirmationMode') return value === 'approval' ? 'Require staff approval' : 'Confirm immediately';
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    if (path === 'featuredVehicleIds') return value.map(id => vehicleNames[String(id)] ?? String(id)).join('\n');
    if (path === 'hours') return value.map(row => `${row.days}: ${row.times}`).join('\n');
    if (path === 'testDriveBooking.weeklyHours') return [...value].sort((a,b)=>((a.day + 6) % 7) - ((b.day + 6) % 7)).map(row => `${weekday[row.day]}: ${row.enabled ? `${row.open}–${row.close}` : 'Closed'}`).join('\n');
    if (path === 'whyBuy') return value.map(row => `${row.title}: ${row.description}`).join('\n');
    if (path === 'presentation.reviews') return value.map(row => `${row.name} · ${row.rating}/5 · ${[row.date,row.source].filter(Boolean).join(' · ')}${row.verified ? ' · Verified' : ''}${row.invited ? ' · Invited' : ''}\n${row.review}`).join('\n\n');
    return value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
  }
  return String(value);
}

/** Read-only comparison. Never changes the shared draft, saved revision or publishing payload. */
export function settingsChanges(published: DealerSettings, draft: DealerSettings, vehicleNames: Readonly<Record<string,string>> = {}): SettingsChange[] {
  const before = flatten(published), after = flatten(draft);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path])).map(path => {
    const section = sectionFor(path);
    return { path, section, group: section === 'contact' || section === 'legal' ? 'Dealership details' : section === 'bookings' ? 'Bookings' : 'Website', label: labelFor(path), published:display(before[path],path,vehicleNames),draft:display(after[path],path,vehicleNames) };
  });
}
