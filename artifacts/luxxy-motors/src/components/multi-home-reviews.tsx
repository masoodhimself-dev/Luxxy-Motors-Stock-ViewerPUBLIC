import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { multiChoiceReviews } from '@/lib/multi-choice-home-sections';
import './multi-home-reviews.css';

type Review = ReturnType<typeof multiChoiceReviews>[number];
type Props = { reviews: Review[]; reviewsUrl?: string; heading: string };
const motion = (): ScrollBehavior => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

function ReviewCard({ review }: { review: Review }) {
  const textId = useId(), text = useRef<HTMLQuoteElement>(null);
  const [expanded, setExpanded] = useState(false), [overflows, setOverflows] = useState(false);
  useEffect(() => { setExpanded(false); }, [review.review]);
  useEffect(() => {
    if (expanded) return;
    let active = true;
    const measure = () => {
      const element = text.current;
      if (active && element && element.clientHeight > 0) setOverflows(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (text.current) observer?.observe(text.current);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [expanded, review.review]);
  return <figure className="multi-home-reviews__card" aria-label={`Review by ${review.name}`}>
    <div className="multi-home-reviews__rating" role="img" aria-label={`${review.rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => <Star key={index} size={17} strokeWidth={1.8} fill={index < review.rating ? 'currentColor' : 'none'} aria-hidden="true" />)}
    </div>
    <blockquote ref={text} id={textId} className="multi-home-reviews__text" data-expanded={expanded || undefined}>{review.review}</blockquote>
    {(overflows || expanded) && <button type="button" className="multi-home-reviews__expand" aria-expanded={expanded} aria-controls={textId} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Read more'}</button>}
    <figcaption><strong>{review.name}</strong><span>{[review.source, review.date].filter(Boolean).join(' · ')}</span></figcaption>
  </figure>;
}

function safeSource(value?: string) {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Reviews and their ratings come from the dealership's existing validated settings. */
export function MultiHomeReviews({ reviews, reviewsUrl, heading }: Props) {
  const viewport = useRef<HTMLDivElement>(null), viewportId = useId();
  const [position, setPosition] = useState({ index: 0, previous: false, next: reviews.length > 1 });
  const source = safeSource(reviewsUrl);
  const update = () => {
    const rail = viewport.current;
    if (!rail || !rail.clientWidth) return;
    const left = rail.getBoundingClientRect().left;
    let index = 0, distance = Infinity;
    Array.from(rail.children).forEach((child, candidate) => {
      const next = Math.abs(child.getBoundingClientRect().left - left);
      if (next < distance) { index = candidate; distance = next; }
    });
    setPosition({ index, previous: rail.scrollLeft > 1, next: rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 1 });
  };
  useEffect(() => {
    const rail = viewport.current;
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (rail) observer?.observe(rail);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [reviews]);
  const goTo = (index: number) => {
    const rail = viewport.current;
    const target = rail?.children[Math.max(0, Math.min(reviews.length - 1, index))];
    if (!rail || !target) return;
    const left = target.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
    if (typeof rail.scrollTo === 'function') rail.scrollTo({ left, behavior: motion() });
    else { rail.scrollLeft = left; update(); }
  };
  return <section id="reviews" className="mh-section multi-home-reviews" aria-labelledby="mh-reviews-heading">
    <div className="multi-home-reviews__heading" data-controls={reviews.length > 1 || undefined}><h2 id="mh-reviews-heading">{heading}</h2>
      {reviews.length > 1 && <div className="multi-home-reviews__arrows" role="group" aria-label="Browse customer reviews">
        <button type="button" aria-label="Previous customer reviews" aria-controls={viewportId} disabled={!position.previous} onClick={() => goTo(position.index - 1)}><ChevronLeft size={22} aria-hidden="true" /></button>
        <button type="button" aria-label="Next customer reviews" aria-controls={viewportId} disabled={!position.next} onClick={() => goTo(position.index + 1)}><ChevronRight size={22} aria-hidden="true" /></button>
      </div>}
    </div>
    {reviews.length > 0 && <div ref={viewport} id={viewportId} className="multi-home-reviews__viewport" role="group" tabIndex={0} aria-label="Customer reviews; scroll for more" onScroll={update} onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      goTo(event.key === 'Home' ? 0 : event.key === 'End' ? reviews.length - 1 : position.index + (event.key === 'ArrowLeft' ? -1 : 1));
    }}>{reviews.map((review, index) => <ReviewCard key={`${review.name}-${review.date}-${index}`} review={review} />)}</div>}
    {reviews.length > 1 && <div className="multi-home-reviews__dots" role="group" aria-label="Choose a customer review">{reviews.map((review, index) => <button key={index} type="button" aria-label={`Show review ${index + 1} by ${review.name}`} aria-controls={viewportId} aria-pressed={position.index === index} onClick={() => goTo(index)}><span /></button>)}</div>}
    {source && <a className="mh-text-link multi-home-reviews__source" href={source} target="_blank" rel="noopener noreferrer">Read customer reviews<ArrowUpRight size={17} aria-hidden="true" /></a>}
  </section>;
}
