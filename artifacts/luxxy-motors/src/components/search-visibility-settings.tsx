import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Check, CircleAlert, ExternalLink, Search } from './icons';
import { Button } from './ui/button';
import './search-visibility-settings.css';

type SearchReadiness = {
  generatedAt: string; origin: string; demonstration: boolean; preview?: boolean;
  status: 'ready_to_submit' | 'needs_details' | 'demo_excluded'; sitemapUrl: string; robotsUrl: string;
  checks: { code: string; label: string; ready: boolean; detail: string; settingsUrl: string }[];
  externalChecks: Record<string, 'unconfirmed'>;
  indexNow?: { enabled: boolean; status: string; manualOnly: boolean; maximumUrlsPerSubmission: number };
};
const links = [
  { title: 'Google Search Console', url: 'https://search.google.com/search-console', text: 'Verify this website, submit its sitemap and inspect a vehicle page.' },
  { title: 'Bing Webmaster Tools', url: 'https://www.bing.com/webmasters/', text: 'Add this website and submit its sitemap to Bing.' },
  { title: 'Google Business Profile', url: 'https://business.google.com/', text: 'Confirm the showroom address, opening hours and website link.' },
];

export function SearchVisibilitySettings() {
  const query = useQuery({ queryKey: ['search-visibility'], queryFn: () => customFetch<SearchReadiness>('/api/staff/search-visibility'), retry: false, throwOnError: false, staleTime: 0 });
  const data = query.isError ? undefined : query.data;
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState(''), [sendNotice, setSendNotice] = useState('');
  async function notifySearchEngines() {
    if (!data?.indexNow?.enabled || data.demonstration || data.preview || sending) return;
    if (!window.confirm('Submit this dealership’s current public page URLs to IndexNow? Private pages and customer details are excluded. This does not guarantee indexing.')) return;
    setSending(true); setSendError(''); setSendNotice('');
    try {
      const result = await customFetch<{ message: string }>('/api/staff/search-visibility/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      setSendNotice(result.message);
    } catch (error) { setSendError(error instanceof Error ? error.message : 'Search notification could not be delivered. Try again later.'); }
    finally { setSending(false); }
  }
  return <section className="search-visibility-settings dealer-admin" aria-labelledby="search-visibility-heading">
    <header className="admin-heading"><div><h2 id="search-visibility-heading">Search visibility</h2><p>Check your published details and set up your search accounts.</p></div><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh checks</Button></header>
    {query.isLoading && <p role="status">Checking published website details…</p>}
    {query.isFetching && data && <p role="status" className="admin-muted">Refreshing published details…</p>}
    {query.isError && <p role="alert" className="admin-error">Search checks could not be loaded. Your website settings have not changed. Try Refresh checks.</p>}
    {data && <>
      {data.preview && <p role="status" className="admin-muted">Local preview using sample dealership details. Set up search accounts on the live dealer domain.</p>}
      <div className="search-readiness-status" data-state={data.demonstration ? 'neutral' : data.status === 'ready_to_submit' ? 'ready' : 'review'}>
        <Search size={20} aria-hidden /><div><h3>{data.demonstration ? 'Demo excluded from search' : data.status === 'ready_to_submit' ? 'Business details are present' : 'Complete your business details'}</h3><p>{data.demonstration ? 'Keep this demonstration out of search results. Set up search accounts after conversion to the live dealer website.' : 'These checks confirm that fields are filled in. They do not verify their accuracy or confirm that search engines have indexed the website.'}</p></div>
      </div>
      <article className="admin-card search-website-address"><h3>Website address</h3><a href={data.origin} target="_blank" rel="noopener noreferrer">{data.origin}<ExternalLink size={15} aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a><p>Use this address consistently in your business listings.</p>{!data.demonstration && !data.preview && <div className="search-resource-links"><a href={data.sitemapUrl} target="_blank" rel="noopener noreferrer">Open sitemap <ExternalLink size={15} aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a><a href={data.robotsUrl} target="_blank" rel="noopener noreferrer">Open crawler rules <ExternalLink size={15} aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a></div>}</article>
      <ul className="search-readiness-checks">{data.checks.map(check => <li key={check.code} data-ready={check.ready}>{check.ready ? <Check size={18} aria-hidden /> : <CircleAlert size={18} aria-hidden />}<div><strong>{check.label}</strong><p>{check.detail}</p></div><Link href={check.settingsUrl}>{check.ready ? 'Review' : 'Add details'}</Link></li>)}</ul>
      {!data.demonstration && <div className="search-account-steps"><h3>Connect your search accounts</h3><p className="admin-muted">Account ownership, indexing and crawler access are unconfirmed. Complete these steps in the provider accounts; this page does not connect them automatically.</p>{links.map((link, index) => <article className="admin-card" key={link.title}><span className="search-step-number" aria-hidden>{index + 1}</span><div><h4>{link.title}</h4><p>{link.text}</p><a href={link.url} target="_blank" rel="noopener noreferrer">Open {link.title} <ExternalLink size={15} aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a></div></article>)}</div>}
      {!data.demonstration && !data.preview && data.indexNow && <article className="admin-card search-indexnow"><h3>Notify search engines</h3><p className="admin-muted">Manually submit current public page URLs to participating search engines through IndexNow. This does not submit to Google or confirm indexing. Automatic stock-change notifications are not enabled.</p><Button type="button" variant="outline" disabled={!data.indexNow.enabled || sending} onClick={() => void notifySearchEngines()}>{sending ? 'Submitting pages…' : 'Submit public pages'}</Button>{!data.indexNow.enabled && <p className="admin-muted">Prepared but switched off. Your platform operator can enable IndexNow after checking the live domain.</p>}{sendError && <p role="alert" className="admin-error">{sendError}</p>}{sendNotice && <p role="status">{sendNotice}</p>}</article>}
      <details className="search-practical-help"><summary>What helps people and AI search find you?</summary><ul><li>Keep prices, availability and showroom information current.</li><li>Use factual descriptions and useful answers about buying from your dealership.</li><li>Ask customers for genuine reviews and keep business listings accurate.</li><li>Allow search crawlers through your website firewall. ChatGPT search uses OAI-SearchBot; training access has separate controls.</li><li>Measure actual enquiries and visits in your search accounts. Search rankings and AI recommendations cannot be guaranteed.</li></ul></details>
    </>}
  </section>;
}
