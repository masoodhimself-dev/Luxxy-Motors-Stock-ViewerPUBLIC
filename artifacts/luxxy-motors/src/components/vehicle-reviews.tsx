import { websiteText } from "@/lib/website-content";
import { useState } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, Star } from 'lucide-react';
import { useDealerSettings } from '@/lib/dealer-settings-context';

export function VehicleReviews() {
 const {settings}=useDealerSettings();
 const [index,setIndex]=useState(0);
 const content=settings.presentation;
 const reviews=content?.reviews ?? [];
 if(!content?.reviewsEnabled || !reviews.length)return null;
 const current=index % reviews.length;
 const review=reviews[current];
 return <section className="vehicle-review-card mt-5 border border-border bg-white p-5 sm:p-6" aria-label="Customer reviews">
  <div className="flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold tracking-tight">{websiteText(settings, "reviewsHeading")}</h2><span className="shrink-0 text-xs text-muted-foreground">{current+1} / {reviews.length}</span></div>
  <div className="mt-5" aria-live="polite" aria-atomic="true">
   <div className="flex gap-1 text-primary" role="img" aria-label={`${review.rating} out of 5 stars`}>{Array.from({length:5},(_,i)=><Star key={i} size={15} aria-hidden="true" fill={i<review.rating?'currentColor':'none'}/>)}</div>
   <blockquote className="mt-3 text-base leading-7 text-foreground">“{review.review}”</blockquote>
   <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2"><p className="text-sm font-semibold">{review.name}</p>{review.verified&&<span className="review-verification" title="Verification confirmed by the dealership"><BadgeCheck size={14} aria-hidden="true"/>Verified review</span>}{review.invited&&<span className="review-invited">Invited</span>}</div>
   <p className="mt-1 text-xs text-muted-foreground">{review.date}{review.source?` · ${review.source}`:''}</p>
  </div>
  <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-3">
   {content.reviewsUrl?<a className="text-link text-xs" href={content.reviewsUrl} target="_blank" rel="noopener noreferrer">Read all reviews</a>:<span className="text-xs text-muted-foreground">Customer experiences</span>}
   {reviews.length>1&&<div className="flex gap-2"><button type="button" aria-label="Previous customer review" className="grid h-11 w-11 place-items-center border border-border hover:bg-secondary" onClick={()=>setIndex((current+reviews.length-1)%reviews.length)}><ArrowLeft size={17}/></button><button type="button" aria-label="Next customer review" className="grid h-11 w-11 place-items-center border border-border hover:bg-secondary" onClick={()=>setIndex((current+1)%reviews.length)}><ArrowRight size={17}/></button></div>}
  </div>
 </section>;
}
