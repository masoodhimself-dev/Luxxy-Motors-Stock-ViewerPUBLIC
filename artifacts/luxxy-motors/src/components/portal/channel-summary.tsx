import { useGetLeadChannelSummary } from '@workspace/api-client-react';
import { LoaderCircle, TrendingUp } from 'lucide-react';
import { EmptyState, Panel, SourceIcon, sourceLabels } from './portal-ui';

/**
 * What each channel actually produced. Won versus lost is the only column the
 * dealer will care about when deciding whether to keep paying for a listing site.
 */
export function ChannelSummary() {
  const summaryQuery = useGetLeadChannelSummary();

  if (summaryQuery.isLoading) {
    return (
      <div className="flex min-h-32 items-center justify-center border border-border bg-card text-primary/70 font-medium">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" /> Counting…
      </div>
    );
  }

  const rows = summaryQuery.data ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Nothing to compare yet"
        body="Once leads start closing, this shows which channels are worth the money."
      />
    );
  }

  const best = Math.max(...rows.map((row) => row.total), 1);

  return (
    <Panel data-testid="channel-summary">
      <header className="border-b border-border bg-background/45 px-5 py-4">
        <p className="luxxy-kicker text-[11px]">Where the business comes from</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-.03em] text-primary">
          By channel
        </h2>
      </header>
      <div className="overflow-x-auto" role="region" aria-label="Channel results" tabIndex={0}><table className="w-full min-w-[540px] text-left"><caption className="sr-only">Enquiries and outcomes by source channel</caption>
        <thead>
          <tr className="border-b border-primary">
            {['Channel', 'Total', 'Open', 'Won', 'Lost', 'Win rate'].map((heading, index) => (
              <th
                key={heading}
                scope="col"
                className={`px-5 py-3 text-xs font-semibold tracking-normal text-muted-foreground ${index === 0 ? '' : 'text-right'}`}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const decided = row.won + row.lost;
            const winRate = decided === 0 ? null : Math.round((row.won / decided) * 100);
            return (
              <tr key={row.source} data-testid={`channel-row-${row.source}`}>
                <th scope="row" className="px-5 py-3.5 font-normal">
                  <span className="flex items-center gap-2.5">
                    <SourceIcon source={row.source} className="h-4 w-4 text-accent" />
                      <span className="font-display text-[15px] font-medium text-primary">
                      {sourceLabels[row.source]}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="mt-2 block h-[3px] bg-accent/50"
                    style={{ width: `${Math.max((row.total / best) * 100, 4)}%` }}
                  />
                </th>
                <td className="px-5 py-3.5 text-right font-mono text-[15px] font-semibold text-foreground">
                  {row.total}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-[15px] text-foreground">
                  {row.open}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-[15px] font-semibold text-primary">
                  {row.won}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-[15px] text-primary/70 font-medium">
                  {row.lost}
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-[15px] text-foreground">
                  {winRate === null ? '—' : `${winRate}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </Panel>
  );
}
