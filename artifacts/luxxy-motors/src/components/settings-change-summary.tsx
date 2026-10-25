import type { DealerSettings } from '@workspace/api-client-react';
import { settingsChanges } from '@/lib/settings-changes';
import { Button } from './ui/button';

export function SettingsChangeSummary({ published, draft, vehicleNames, onEdit }: {
  published: DealerSettings;
  draft: DealerSettings;
  vehicleNames?: Readonly<Record<string,string>>;
  onEdit: (section: string) => void;
}) {
  const changes = settingsChanges(published, draft, vehicleNames);
  return <section className="mb-6 rounded-md border border-border p-4" aria-labelledby="settings-changes-heading" data-testid="settings-change-summary">
    <h3 id="settings-changes-heading" className="font-semibold">Changes to publish <span className="font-normal text-muted-foreground">({changes.length})</span></h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Compared with the most recently loaded published settings. Open a change to compare its wording or value. Publishing still applies your complete shared draft.</p>
    {!changes.length ? <p className="mt-3 text-sm">No changes from the loaded publication.</p> : (['Dealership details','Website','Bookings'] as const).map(group => {
      const items = changes.filter(change => change.group === group);
      if (!items.length) return null;
      return <div key={group} className="mt-4 border-t border-border pt-3"><h4 className="text-sm font-semibold">{group} <span className="font-normal text-muted-foreground">· {items.length} {items.length === 1 ? 'change' : 'changes'}</span></h4><ul className="mt-2 divide-y divide-border">{items.map(change => <li key={change.path}>
        <details className="py-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{change.label}</summary><dl className="grid min-w-0 gap-4 py-2 sm:grid-cols-2"><div className="min-w-0"><dt className="mb-1 text-xs font-semibold text-muted-foreground">Published</dt><dd className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm" data-testid={`change-published-${change.path}`}>{change.published}</dd></div><div className="min-w-0"><dt className="mb-1 text-xs font-semibold text-muted-foreground">Your draft</dt><dd className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm" data-testid={`change-draft-${change.path}`}>{change.draft}</dd></div></dl><Button type="button" variant="link" className="min-h-11 px-0" onClick={()=>onEdit(change.section)} aria-label={`Edit ${change.label}`}>Edit this setting</Button></details>
      </li>)}</ul></div>;
    })}
  </section>;
}
