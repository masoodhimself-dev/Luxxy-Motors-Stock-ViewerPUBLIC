import { websiteText } from '@/lib/website-content';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Star, BadgeCheck } from '@/components/icons';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { TermHelp } from '@/components/customer-help';
import './customer-reviews.css';

export function CustomerReviews() {
  const { settings } = useDealerSettings();
  const content = settings.presentation;
  const reviews = content?.reviews || [];
  const track = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [navigation, setNavigation] = useState({ overflow: false, previous: false, next: false });
  useEffect(() => {
    const list = track.current;
    if (!list) return;
    const update = () => {
      const overflow = list.scrollWidth > list.clientWidth + 2;
      const next = { overflow, previous: overflow && list.scrollLeft > 2, next: overflow && list.scrollLeft + list.clientWidth < list.scrollWidth - 2 };
      setNavigation(current => current.overflow === next.overflow && current.previous === next.previous && current.next === next.next ? current : next);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(list);
    list.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); list.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [reviews.length, content?.reviewsEnabled]);
  if (!content?.reviewsEnabled || !reviews.length) return null;
  const move = (direction: number) => {
    const list = track.current;
    const card = list?.firstElementChild as HTMLElement | null;
    if (!list || !card) return;
    const gap = parseFloat(window.getComputedStyle(list).columnGap) || 0;
    list.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <section aria-labelledby="reviews-heading" className="customer-reviews review-story-layout border-t border-border">
    <div className="review-layout container mx-auto px-4 sm:px-6 lg:px-8">
      <header className="review-intro">
        <div className="review-intro-copy"><h2 id="reviews-heading" className="section-heading">{websiteText(settings, 'reviewsHeading')}</h2><p className="review-count">{reviews.length} {reviews.length === 1 ? 'review shown' : 'reviews shown'}</p></div>
        {navigation.overflow && <nav className="review-navigation" aria-label="Browse customer reviews">
          <button type="button" disabled={!navigation.previous} onClick={() => move(-1)} aria-label="Previous reviews"><ArrowLeft size={18} aria-hidden="true" /></button>
          <button type="button" disabled={!navigation.next} onClick={() => move(1)} aria-label="Next reviews"><ArrowRight size={18} aria-hidden="true" /></button>
        </nav>}
        {content.reviewsUrl && <a href={content.reviewsUrl} target="_blank" rel="noopener noreferrer" className="review-all-link">Read all reviews <ArrowRight size={15} aria-hidden="true" /></a>}
      </header>
      <ul ref={track} aria-label="Customer reviews" tabIndex={0} className="review-track">
        {reviews.map((review, index) => <li key={index} className="review-panel">
          <div className="review-stars" role="img" aria-label={`${review.rating} out of 5 stars`}>
            {Array.from({ length: 5 }, (_, star) => <Star key={star} size={15} aria-hidden="true" fill={star < review.rating ? 'currentColor' : 'none'} />)}
          </div>
          <blockquote className={expanded.has(index) || review.review.length <= 180 ? '' : 'line-clamp-4'}>{review.review}</blockquote>
          {review.review.length > 180 && <button type="button" aria-expanded={expanded.has(index)} className="review-read-more" onClick={() => setExpanded(current => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next; })}>{expanded.has(index) ? 'Show less' : 'Read full review'}</button>}
          <footer className="review-byline">
            <div className="review-author-row"><cite>{review.name}</cite>{review.verified && <TermHelp className="review-verification" text="We’ve confirmed this review."><BadgeCheck size={14} aria-hidden="true" />Verified review</TermHelp>}{review.invited && <TermHelp className="review-invited" text="We invited this customer to leave a review.">Invited</TermHelp>}</div>
            <p className="review-source-row"><span>{review.date}</span>{review.source && <span className="review-source">{review.source}</span>}</p>
          </footer>
        </li>)}
      </ul>
    </div>
  </section>;
}
