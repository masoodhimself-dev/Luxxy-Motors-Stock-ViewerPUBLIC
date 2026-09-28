import { useState } from 'react';
import type { DealerPresentation } from '@workspace/api-client-react';
import { websiteFields } from '@/lib/website-content';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

export function WebsiteContentEditor({ value, onChange }: { value: DealerPresentation; onChange: (value: DealerPresentation) => void }) {
  const [search, setSearch] = useState('');
  const groups = [...new Set(websiteFields.map(field => field.group))];
  const filtered = websiteFields.filter(field => `${field.group} ${field.label} ${field.defaultValue}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-muted-foreground">Choose a page and edit its wording. Leave a field empty to use the standard text shown underneath. Vehicle facts, prices, payment messages and validation remain controlled by the application.</p>
    <label className="block text-sm font-medium">Find a page or phrase<Input className="mt-2" value={search} onChange={event => setSearch(event.target.value)} placeholder="For example: contact, stock, reviews" /></label>
    {groups.map(group => {
      const fields = filtered.filter(field => field.group === group);
      if (!fields.length) return null;
      return <details key={group} className="rounded border border-border bg-background p-4" open={search ? true : undefined}>
        <summary className="cursor-pointer py-2 text-base font-semibold">{group}<span className="ml-2 text-xs font-normal text-muted-foreground">{fields.length} {fields.length === 1 ? "field" : "fields"}</span></summary>
        <div className="mt-4 grid gap-5">{fields.map(field => <label key={field.key} className="block text-sm font-medium">
          {field.label}
          <Textarea className="mt-2" rows={field.defaultValue.length > 90 ? 3 : 2} maxLength={1000} value={value.websiteCopy?.[field.key] || ''} onChange={event => onChange({ ...value, websiteCopy: { ...value.websiteCopy, [field.key]: event.target.value } })} data-testid={`input-copy-${field.key}`} />
          <span className="mt-2 block text-xs font-normal leading-5 text-muted-foreground">Standard: {field.defaultValue}</span>
        </label>)}</div>
      </details>;
    })}
    {!filtered.length && <p role="status" className="text-sm text-muted-foreground">No matching content fields. Try another phrase.</p>}
  </div>;
}
