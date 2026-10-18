import { Link } from 'wouter';
import { Button } from './ui/button';
export function FeatureUnavailable({ title, loading, error, retry }: { title: string; loading?: boolean; error?: boolean; retry?: () => void }) {
  if (loading) return <p role="status" className="py-5 text-sm text-muted-foreground">Checking availability…</p>;
  return <div className="space-y-4 border border-border bg-secondary/30 p-5">
    <h2 className="text-lg font-semibold">{error ? 'We couldn’t check availability' : title}</h2>
    <p className="text-sm leading-6 text-muted-foreground">{error ? 'Your details have not been sent. Try again or contact the showroom directly.' : 'Please contact the showroom directly and we’ll help with your request.'}</p>
    <div className="flex flex-wrap gap-3">{error && retry && <Button type="button" variant="outline" onClick={retry}>Try again</Button>}<Button asChild variant="outline"><Link href="/contact">Contact the showroom</Link></Button></div>
  </div>;
}
