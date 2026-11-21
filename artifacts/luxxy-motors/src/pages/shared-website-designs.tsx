import { useEffect, useId, useState } from 'react';
import { isWebsiteTemplateId, websiteTemplateDefinition, type WebsiteTemplateDefinition } from '@workspace/vehicle-meta';
import { ChevronRight } from '@/components/icons';
import './shared-website-designs.css';

type DesignChoices = { dealerName: string; templates: WebsiteTemplateDefinition[] };
type State = { kind: 'loading' | 'expired' | 'unavailable' | 'failed' } | { kind: 'ready'; choices: DesignChoices };

function readChoices(data: unknown): DesignChoices | null {
  if (!data || typeof data !== 'object') return null;
  const { dealerName, templates } = data as { dealerName?: unknown; templates?: unknown };
  if (typeof dealerName !== 'string' || !dealerName.trim() || !Array.isArray(templates) || !templates.length || templates.length > 3) return null;
  const ids: unknown[] = templates.map((item: { id?: unknown } | null) => item?.id);
  if (!ids.every(isWebsiteTemplateId) || new Set(ids).size !== ids.length) return null;
  return { dealerName: dealerName.trim(), templates: ids.map(websiteTemplateDefinition) };
}

export default function SharedWebsiteDesigns({ base }: { base: string }) {
  const titleId = useId();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    async function load(): Promise<State> {
      const response = await fetch(`${base}/api/designs`, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (response.status === 410) return { kind: 'expired' };
      if ([401, 403, 404].includes(response.status)) return { kind: 'unavailable' };
      if (!response.ok) return { kind: 'failed' };
      const choices = readChoices(await response.json());
      return choices ? { kind: 'ready', choices } : { kind: 'failed' };
    }
    void load().then(result => {
      if (!controller.signal.aborted) setState(result);
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'failed' });
    });
    return () => controller.abort();
  }, [base, attempt]);

  const dealerName = state.kind === 'ready' ? state.choices.dealerName : '';
  useEffect(() => {
    const previousTitle = document.title;
    document.title = dealerName ? `Website designs | ${dealerName}` : 'Website designs';
    return () => { document.title = previousTitle; };
  }, [dealerName]);

  const title = state.kind === 'expired' ? 'This link has expired'
    : state.kind === 'unavailable' ? 'This link is unavailable'
    : state.kind === 'failed' ? 'The website designs could not load'
    : 'Choose a website design';

  return <main className="shared-website-designs" aria-labelledby={titleId}>
    <div className="shared-website-designs-inner">
      {dealerName && <p className="shared-website-designs-dealer">{dealerName}</p>}
      <h1 id={titleId}>{title}</h1>
      {state.kind === 'loading' && <p role="status">Loading website designs…</p>}
      {state.kind === 'ready' && <>
        <p>Each design uses the same cars and dealership details.</p>
        <ul className="shared-website-designs-options" aria-label="Website designs">
          {state.choices.templates.map(template => {
            const optionId = `${titleId}-${template.id}`;
            return <li key={template.id}>
              <a href={`${base}/design/${template.id}/`} referrerPolicy="no-referrer" aria-labelledby={optionId} aria-describedby={`${optionId}-description`}>
                <span className="shared-website-designs-option-copy">
                  <strong id={optionId}>{template.name}</strong>
                  <span id={`${optionId}-description`}>{template.description}</span>
                </span>
                <ChevronRight size={22} aria-hidden="true" />
              </a>
            </li>;
          })}
        </ul>
      </>}
      {(state.kind === 'expired' || state.kind === 'unavailable') && <p role="alert">Ask the person who shared this link for a new one.</p>}
      {state.kind === 'failed' && <>
        <p role="alert">Check your connection and try again.</p>
        <button type="button" className="shared-website-designs-retry" onClick={() => setAttempt(current => current + 1)}>Try again</button>
      </>}
    </div>
  </main>;
}
