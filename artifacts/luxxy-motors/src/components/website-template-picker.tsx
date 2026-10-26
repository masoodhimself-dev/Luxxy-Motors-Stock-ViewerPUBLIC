import { lazy, Suspense, useState } from 'react';
import type { DealerSettings } from '@workspace/api-client-react';
import { websiteTemplates, resolveWebsiteTemplate, type WebsiteTemplate } from '@/lib/website-templates';
import { Button } from '@/components/ui/button';

const CustomerPagePreview = lazy(() => import('./customer-page-preview'));

/** Layout choices join the shared draft; opening a preview never publishes it. */
export function WebsiteTemplatePicker({ settings, publishedTemplate, onChange }: {
  settings: DealerSettings;
  publishedTemplate?: WebsiteTemplate;
  onChange: (template: WebsiteTemplate | undefined) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const selected = resolveWebsiteTemplate(settings.presentation?.websiteTemplate);
  const published = resolveWebsiteTemplate(publishedTemplate);
  const selectedName = websiteTemplates.find(template => template.id === selected)!.name;
  return <div className="mb-8 border-b border-border pb-8" data-testid="website-template-picker">
    <fieldset>
      <legend className="text-base font-semibold">Website template</legend>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground" id="website-template-help">Choose a layout for your homepage, stock and vehicle pages. Your logo, colours, fonts, wording and featured-car choices carry across. Your published website changes only after Review &amp; publish.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-describedby="website-template-help">
        {websiteTemplates.map(template => <label key={template.id} className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-md border p-4 ${selected === template.id ? 'border-primary bg-secondary/30' : 'border-border bg-card'}`}>
          <input type="radio" name="website-template" value={template.id} checked={selected === template.id} onChange={() => onChange(template.id === published ? publishedTemplate : template.id)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary" aria-label={template.name} aria-describedby={`website-template-${template.id}-description`} />
          <span className="min-w-0"><span className="block font-semibold">{template.name}</span><span className="mt-1 block text-sm leading-6 text-muted-foreground" id={`website-template-${template.id}-description`}>{template.description}</span></span>
        </label>)}
      </div>
    </fieldset>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>Preview selected template</Button>
      {selected !== published && <Button type="button" variant="ghost" onClick={() => onChange(publishedTemplate)}>Keep published template</Button>}
      <p className="text-sm text-muted-foreground">Selected: {selectedName}. Preview with your current cars before publishing.</p>
    </div>
    {previewOpen && <Suspense fallback={<p role="status" className="mt-3 text-sm">Loading website preview…</p>}><CustomerPagePreview settings={settings} onClose={() => setPreviewOpen(false)} /></Suspense>}
  </div>;
}
