import type { Enquiry } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { enquiryGroup, primaryEnquiry } from '@/lib/enquiry-groups';

/** Keep original appointments and follow-ups recognisable inside a combined case. */
export function EnquiryMergeLabel({ entry, entries }: { entry: Enquiry; entries: readonly Enquiry[] }) {
  const primary = primaryEnquiry(entry, entries);
  const group = enquiryGroup(primary, entries);
  if (group.length < 2) return null;
  return <p className="text-xs text-muted-foreground">
    Part of merged case{' '}
    <Link className="inline-flex min-h-8 items-center font-medium text-primary underline underline-offset-2" href={`/portal?section=enquiries&enquiryId=${encodeURIComponent(primary.id)}`}>{primary.reference}</Link>
    {' '}· {group.length} original records
  </p>;
}
