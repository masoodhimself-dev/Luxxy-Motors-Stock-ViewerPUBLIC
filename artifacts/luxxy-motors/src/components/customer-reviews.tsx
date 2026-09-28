import { websiteText } from "@/lib/website-content";
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Star, BadgeCheck } from 'lucide-react';
import { useDealerSettings } from '@/lib/dealer-settings-context';

export function CustomerReviews() {
  const { settings } = useDealerSettings();
  const content = settings.presentation;
  const reviews = content?.reviews || [];
  const track = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  if (!content?.reviewsEnabled || !reviews.length) return null;
  const move = (direction: number) => {
    const list = track.current;
    if (!list) return;
    const card = list.firstElementChild as HTMLElement;
    list.scrollBy({ left: direction * (card.getBoundingClientRect().width + 20), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <section aria-labelledby="reviews-heading" className="customer-reviews border-t border-border bg-card py-10">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id="reviews-heading" className="section-heading">{websiteText(settings, "reviewsHeading")}</h2>
        {reviews.length > 1 && <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => move(-1)} aria-label="Previous reviews" className="grid size-11 place-items-center border border-border hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft size={18} /></button>
          <button type="button" onClick={() => move(1)} aria-label="Next reviews" className="grid size-11 place-items-center border border-border hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><ArrowRight size={18} /></button>
        </div>}
      </div>
      <ul ref={track} aria-label="Customer reviews" tabIndex={0} className="review-track">
        {reviews.map((review, index) => <li key={index} className="review-panel">
          <div className="flex gap-1 text-primary" role="img" aria-label={`${review.rating} out of 5 stars`}>
            {Array.from({length: 5}, (_, star) => <Star key={star} size={16} aria-hidden="true" fill={star < review.rating ? 'currentColor' : 'none'} />)}
          </div>
          <blockquote className={`mt-4 text-[15px] leading-7 ${expanded.has(index) || review.review.length <= 180 ? '' : 'line-clamp-4'}`}>{review.review}</blockquote>
          {review.review.length > 180 && <button type="button" aria-expanded={expanded.has(index)} className="mt-1 min-h-11 self-start text-sm underline underline-offset-4" onClick={() => setExpanded(current => {const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next;})}>{expanded.has(index) ? 'Show less' : 'Read full review'}</button>}
          <div className="mt-auto pt-6"><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><p className="text-sm font-semibold">{review.name}</p>{review.verified && <span className="review-verification" title="Verification confirmed by the dealership"><BadgeCheck size={14} aria-hidden="true" />Verified review</span>}{review.invited && <span className="review-invited">Invited</span>}</div><p className="mt-1 text-sm text-muted-foreground">{review.date}{review.source && ` · ${review.source}`}</p></div>
        </li>)}
      </ul>
      {content.reviewsUrl && <a href={content.reviewsUrl} target="_blank" rel="noopener noreferrer" className="text-link mt-5">Read all reviews <ArrowRight size={16} /></a>}
    </div>
  </section>;
}
