import { customerDefaultCopy, websiteText } from '@/lib/website-content';
import { ArrowRight } from '@/components/icons';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { ShowroomPhoto } from './showroom-photo';
import { ShowroomVisitPanel } from './showroom-visit-panel';

export function DealershipVisit({ children }: { children?: React.ReactNode }) {
  const { settings, isLoading, isError } = useDealerSettings();
  const content = settings.presentation ?? {};
  const ready = !isLoading && !isError;
  const hasTeam = ready && Boolean(content.teamImageUrl && content.teamIntroduction?.trim() && !/^sample|tell customers|replace this/i.test(content.teamIntroduction.trim()));
  const hasStory = Boolean(hasTeam || ready && content.reviewsUrl || children);
  return <section id="visit" className="border-t border-border bg-card py-8 md:py-10" aria-labelledby="visit-heading">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <h2 id="visit-heading" tabIndex={-1} className="section-heading">{websiteText(settings, 'visitHeading')}</h2>
      <div className={`mt-5 grid items-start gap-6 lg:gap-8 ${hasStory ? 'lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]' : ''}`}>
        <ShowroomVisitPanel heading={null} />
        {hasStory && <div className="visit-story grid gap-5">
          {children}
          {hasTeam && <div>
            <ShowroomPhoto src={content.teamImageUrl!} alt={customerDefaultCopy(content.teamImageAlt, 'Our team', ['The dealership team'])} className="mb-5 aspect-[16/9]" />
            <h3 className="text-base font-semibold">{websiteText(settings, 'teamHeading')}</h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{content.teamIntroduction}</p>
          </div>}
          {ready && content.reviewsUrl && <div className="border-y border-border py-5">
            <h3 className="text-base font-semibold">Hear from our customers</h3>
            <a href={content.reviewsUrl} target="_blank" rel="noopener noreferrer" className="text-link mt-2">Read customer reviews <ArrowRight className="h-4 w-4" /></a>
          </div>}
        </div>}
      </div>
    </div>
  </section>;
}
