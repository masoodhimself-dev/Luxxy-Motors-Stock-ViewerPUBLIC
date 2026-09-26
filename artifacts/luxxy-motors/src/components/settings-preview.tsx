import type { DealerSettings } from '@workspace/api-client-react';
import { ShowroomPhoto } from './showroom-photo';

export function launchChecks(settings: DealerSettings) {
  const sample = (value: unknown) => /sample|example road|replace (this|these)|tell customers|template/i.test(JSON.stringify(value || ''));
  return [
    { label: 'Contact details', issue: !settings.contact.phone && !settings.contact.email ? 'Add a phone number or email' : sample(settings.contact) ? 'Replace sample contact details' : null },
    { label: 'Showroom address', issue: !settings.address.street || !settings.address.postcode ? 'Add address and postcode' : sample(settings.address) ? 'Replace the sample address' : null },
    { label: 'Opening hours', issue: !settings.hours.length ? 'Add opening hours' : sample(settings.hours) ? 'Replace sample opening hours' : null },
    { label: 'Visiting information', issue: sample([settings.presentation?.visitInstructions, settings.presentation?.parkingInstructions]) ? 'Replace template visiting instructions' : null },
    { label: 'Dealership photography', issue: !settings.presentation?.showroomImageUrl ? 'Add a genuine showroom photo or confirm the illustration is suitable' : null },
    { label: 'Online payments', issue: settings.onlineReservation?.enabled ? 'Payments are simulated — connect and test payments before launch' : null },
  ];
}
export function LaunchReadiness({ settings }: { settings: DealerSettings }) {
  const checks = launchChecks(settings);
  return <details className="mb-6 border-y border-border py-3 text-sm">
    <summary className="min-h-11 cursor-pointer py-3 font-semibold">Launch readiness · {checks.filter(check => check.issue).length} items to review</summary>
    <p className="my-3 text-muted-foreground">Based on this draft. Passing a check confirms a field is present, not that its contents are accurate. Review before publishing.</p>
    <ul className="divide-y divide-border">{checks.map(check => <li key={check.label} className="flex flex-wrap justify-between gap-2 py-3"><span className="font-medium">{check.label}</span><span className={check.issue ? 'text-amber-800' : 'text-muted-foreground'}>{check.issue || 'Added / not required — confirm accuracy'}</span></li>)}</ul>
  </details>;
}
export function SettingsPreview({ settings }: { settings: DealerSettings }) {
  const photo = settings.presentation?.heroImageUrl || settings.presentation?.showroomImageUrl;
  const review = settings.presentation?.reviewsEnabled && settings.presentation.reviews?.[0];
  return <details className="mb-6 border border-border bg-card p-4">
    <summary className="min-h-11 cursor-pointer py-2 font-semibold">Preview your draft appearance</summary>
    <p className="mb-4 text-sm text-muted-foreground">A small preview of your content and brand colours. Changes are not published until you save.</p>
    <div className="grid gap-5 md:grid-cols-2">
      <div className="overflow-hidden border border-border">
        <div className="p-4 text-white" style={{background: `hsl(${settings.identity.brandColors.primaryHsl})`}}>{settings.identity.name}</div>
        {photo && /^https:\/\//.test(photo) && <ShowroomPhoto src={photo} alt="Draft homepage photograph" className="aspect-video" />}
        <div className="p-4"><p className="text-lg font-semibold">{settings.hero.copy}</p><p className="mt-2 text-sm">{settings.hero.subcopy}</p><span className="mt-4 inline-block px-4 py-2 text-sm" style={{borderLeft: `4px solid hsl(${settings.identity.brandColors.accentHsl})`, background: "#f3f4f4", color: "#172126"}}>Browse Stock</span></div>
      </div>
      <div className="border border-border p-4"><h3 className="font-semibold">Customer review preview</h3>{review ? <><p className="mt-3" aria-label={`${review.rating} stars`}>{'★'.repeat(review.rating)}</p><blockquote className="mt-3 text-sm leading-6">{review.review}</blockquote><p className="mt-4 text-sm font-medium">{review.name}{review.verified ? ' · Verified review' : ''}{review.invited ? ' · Invited' : ''}</p></> : <p className="mt-3 text-sm text-muted-foreground">No reviews enabled. This section will stay hidden.</p>}</div>
    </div>
  </details>;
}
