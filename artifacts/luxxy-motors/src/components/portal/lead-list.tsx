import { useEffect, useMemo, useState } from 'react';
import {
  GetLeadsSource,
  GetLeadsStage,
  useGetLeads,
  type GetLeadsParams,
} from '@workspace/api-client-react';
import { LoaderCircle, Search, SlidersHorizontal, Users, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LeadCard } from './lead-card';
import {
  EmptyState,
  SelectField,
  sourceLabels,
  stageLabels,
} from './portal-ui';
import { Field } from './lead-form-fields';

const stageOptions: Array<{ value: string; label: string }> = [
  { value: GetLeadsStage.open, label: 'Open only' },
  { value: GetLeadsStage.all, label: 'Every stage' },
  ...([
    'new',
    'qualifying',
    'viewing_booked',
    'offer',
    'reserved',
    'sale_agreed',
    'collected',
    'won',
    'lost',
  ] as const).map(
    (stage) => ({ value: stage, label: stageLabels[stage] }),
  ),
];

const sourceOptions: Array<{ value: string; label: string }> = [
  { value: GetLeadsSource.all, label: 'Every channel' },
  ...(Object.values(GetLeadsSource).filter((value) => value !== 'all') as Array<
    keyof typeof sourceLabels
  >).map((source) => ({ value: source, label: sourceLabels[source] })),
];

export function LeadList({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<string>(GetLeadsStage.open);
  const [source, setSource] = useState<string>(GetLeadsSource.all);
  const [owner, setOwner] = useState('');

  // Typing a registration shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = useMemo<GetLeadsParams>(
    () => ({
      ...(search ? { search } : {}),
      stage: stage as GetLeadsParams['stage'],
      source: source as GetLeadsParams['source'],
      ...(owner.trim() ? { owner: owner.trim() } : {}),
    }),
    [search, stage, source, owner],
  );

  const leadsQuery = useGetLeads(params);
  const leads = leadsQuery.data ?? [];
  const filtered =
    search !== '' ||
    stage !== GetLeadsStage.open ||
    source !== GetLeadsSource.all ||
    owner.trim() !== '';

  const reset = () => {
    setSearchInput('');
    setSearch('');
    setStage(GetLeadsStage.open);
    setSource(GetLeadsSource.all);
    setOwner('');
  };

  return (
    <div className="space-y-5" data-testid="lead-list">
      <div className="luxxy-surface rounded-md border border-border p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 basis-full lg:basis-60 flex-1">
            <Field label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70 font-medium" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Name, phone, email, registration or car"
                  className="rounded-md pl-9"
                  data-testid="input-search"
                />
              </div>
            </Field>
          </div>
           <div className="w-full sm:w-[170px]">
            <Field label="Stage">
              <SelectField
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                data-testid="select-stage-filter"
              >
                {stageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </Field>
          </div>
           <div className="w-full sm:w-[170px]">
            <Field label="Channel">
              <SelectField
                value={source}
                onChange={(event) => setSource(event.target.value)}
                data-testid="select-source-filter"
              >
                {sourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </Field>
          </div>
           <div className="w-full sm:w-[170px]">
            <Field label="Owner">
              <Input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="Anyone"
                className="rounded-md"
                data-testid="input-owner-filter"
              />
            </Field>
          </div>
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 rounded-sm text-[12px] font-semibold tracking-normal text-primary/70"
              onClick={reset}
              data-testid="button-clear-filters"
            >
              <X className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
         <p className="font-display text-[11px] font-semibold tracking-normal text-primary/70">
          {leadsQuery.isLoading
            ? 'Searching'
            : `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}`}
        </p>
         <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <SlidersHorizontal className="h-3 w-3" /> Most urgent first
        </p>
      </div>

      {leadsQuery.isLoading ? (
         <div className="luxxy-surface flex min-h-32 items-center justify-center rounded-lg border border-border text-primary/70">
          <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" /> Searching…
        </div>
      ) : leadsQuery.isError ? (
         <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-[13px] text-destructive">
           <p className="font-display text-base font-semibold">Could not load leads</p>
          <p className="mt-1">Refresh the page, or check the API server is running.</p>
        </div>
      ) : leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? 'Nothing matches' : 'No leads yet'}
          body={
            filtered
              ? 'Widen the search or clear the filters.'
              : 'Website enquiries appear here on their own. Add a walk-in or a phone call with New lead.'
          }
        />
      ) : (
        <div className="surface overflow-hidden">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onOpen={onOpenLead} />
          ))}
        </div>
      )}
    </div>
  );
}
