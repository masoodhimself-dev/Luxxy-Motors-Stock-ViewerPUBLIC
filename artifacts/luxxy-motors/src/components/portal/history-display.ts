import type { DealerRelationships } from '@workspace/vehicle-meta';

type Activity = DealerRelationships['vehicles'][number]['activities'][number];

/** Hide identifiers in the old generated merge summary, retaining the original saved record and staff note. */
export function historyDescription(activity: Activity, activities: readonly Activity[]) {
  if (!activity.id.startsWith('enquiry-event:')) return activity.description;
  const [summary, ...notes] = activity.description.split('\n\n');
  const identifiers = new Set(activities.flatMap(item => [item.recordId, item.reference]).filter(Boolean));
  let label = summary;
  for (const identifier of identifiers) {
    label = label.replaceAll(`Record combined into case ${identifier} by `, 'Record combined into the main case by ');
  }
  return [label, ...notes].join('\n\n');
}
