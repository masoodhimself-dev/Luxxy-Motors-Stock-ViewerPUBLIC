import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CarImage, cn, getSafeImageUrl } from '../_data';

function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({ images, heroImage }: { images: CarImage[]; heroImage?: string | null }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const allImages = [...images];
  if (heroImage && !allImages.find((image) => getSafeImageUrl(image) === heroImage)) allImages.unshift(heroImage);
  const handleNext = useCallback(() => setActiveIndex((previous) => previous === allImages.length - 1 ? 0 : previous + 1), [allImages.length]);
  const handlePrev = useCallback(() => setActiveIndex((previous) => previous === 0 ? allImages.length - 1 : previous - 1), [allImages.length]);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleTouchStart = (event: TouchEvent) => setTouchStart(event.touches[0].clientX);
  const handleTouchEnd = (event: TouchEvent) => {
    if (touchStart === null) return;
    const diff = touchStart - event.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? handleNext() : handlePrev();
    setTouchStart(null);
  };

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') handleNext();
      if (event.key === 'ArrowLeft') handlePrev();
      if (event.key === 'Escape') {
        setIsFullscreen(false);
        openerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, isFullscreen]);

  if (allImages.length === 0) {
    return <div className="flex aspect-[4/3] sm:aspect-[16/10] lg:aspect-[16/9] w-full max-w-[900px] flex-col items-center justify-center gap-4 border-4 border-primary bg-primary/5 text-primary shadow-[8px_8px_0px_hsl(var(--primary))]"><Camera className="h-10 w-10 opacity-40" /><span className="font-display text-[13px] font-black uppercase tracking-[0.2em]">No images available</span></div>;
  }

  const currentImg = allImages[activeIndex];
  const url = getSafeImageUrl(currentImg);
  const caption = imageCaption(currentImg);
  const arrowButton = 'absolute top-1/2 z-10 grid h-14 w-14 -translate-y-1/2 place-items-center bg-primary text-primary-foreground opacity-0 transition-all hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 shadow-[4px_4px_0px_hsl(var(--primary))] border-2 border-primary-foreground/20';
  const renderImage = (imageUrl: string, index: number, className = '') => failedImages.has(index)
    ? <div className={cn('flex h-full w-full flex-col items-center justify-center gap-3 bg-primary/5 border-4 border-primary text-primary shadow-[8px_8px_0px_hsl(var(--primary))]', className)}><Camera className="h-8 w-8 opacity-20" /><span className="font-display text-[11px] font-black uppercase tracking-[0.2em] opacity-50">Image missing</span></div>
    : <img src={imageUrl} alt={imageCaption(allImages[index]) || `Vehicle image ${index + 1}`} className={className} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImages((previous) => new Set(previous).add(index))} />;

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4 overflow-hidden max-w-[900px]">
      <div className="group relative aspect-[4/3] w-full overflow-hidden border-4 border-primary bg-primary/5 sm:aspect-[16/10] lg:aspect-[16/9] shadow-[8px_8px_0px_hsl(var(--primary))]" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {renderImage(url, activeIndex, 'absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105')}
        <div className="absolute inset-0 bg-primary/0 transition-colors group-hover:bg-primary/5 pointer-events-none" />
        <button type="button" ref={openerRef} aria-label="View gallery fullscreen" className="absolute inset-0 z-0 w-full h-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent" onClick={() => setIsFullscreen(true)} />
        {allImages.length > 1 && <><button type="button" className={cn(arrowButton, 'left-4')} onClick={(event) => { event.stopPropagation(); handlePrev(); }} aria-label="Previous photograph"><ChevronLeft className="h-6 w-6" /></button><button type="button" className={cn(arrowButton, 'right-4')} onClick={(event) => { event.stopPropagation(); handleNext(); }} aria-label="Next photograph"><ChevronRight className="h-6 w-6" /></button><span className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-2 bg-primary px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary-foreground border-2 border-primary-foreground/20 shadow-[2px_2px_0px_hsl(var(--primary))]"><Camera className="h-4 w-4" />{activeIndex + 1} / {allImages.length}</span></>}
        {caption && <span className="pointer-events-none absolute bottom-4 left-4 max-w-[80%] truncate bg-primary px-4 py-2 font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary-foreground border-2 border-primary-foreground/20 shadow-[2px_2px_0px_hsl(var(--primary))]">{caption}</span>}
      </div>
      {allImages.length > 1 && <div className="flex min-w-0 max-w-full snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2 scroll-smooth no-scrollbar pt-2">{allImages.map((image, index) => <button key={index} type="button" onClick={() => setActiveIndex(index)} aria-label={`Show photograph ${index + 1} of ${allImages.length}`} aria-current={activeIndex === index} className={cn('relative h-[4.5rem] w-[6.5rem] shrink-0 snap-start overflow-hidden border-2 transition-all focus-visible:outline-none sm:h-[5.5rem] sm:w-[8rem]', activeIndex === index ? 'border-accent shadow-[4px_4px_0px_hsl(var(--accent))] -translate-y-1' : 'border-primary opacity-60 hover:opacity-100 hover:shadow-[2px_2px_0px_hsl(var(--primary))]')} >{renderImage(getSafeImageUrl(image), index, 'h-full w-full object-cover')}</button>)}</div>}
      {isFullscreen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-primary/95 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Vehicle image gallery">
        <button type="button" ref={closeButtonRef} onClick={() => { setIsFullscreen(false); openerRef.current?.focus(); }} aria-label="Close photograph viewer" className="absolute right-6 top-6 z-50 grid h-14 w-14 place-items-center border-4 border-primary-foreground bg-primary text-primary-foreground transition-all hover:bg-accent hover:border-accent"><X className="h-8 w-8" /></button>
        <div className="flex w-full max-w-7xl items-center justify-between px-4">
          <button type="button" onClick={(event) => { event.stopPropagation(); handlePrev(); }} aria-label="Previous photograph" className="hidden p-4 text-primary-foreground/50 transition-colors hover:text-accent sm:block"><ChevronLeft className="h-14 w-14" /></button>
          <div className="relative flex max-h-[90vh] w-full flex-col items-center justify-center">{renderImage(url, activeIndex, 'max-h-[82vh] max-w-full select-none object-contain border-4 border-primary-foreground shadow-[12px_12px_0px_hsl(var(--primary))]')}<div className="mt-8 flex items-center gap-6 bg-primary-foreground text-primary px-6 py-3 font-display text-[12px] font-black uppercase tracking-[0.2em] shadow-[4px_4px_0px_hsl(var(--primary))]"><span>{activeIndex + 1} / {allImages.length}</span>{caption && <span className="text-primary/70">{caption}</span>}</div></div>
          <button type="button" onClick={(event) => { event.stopPropagation(); handleNext(); }} aria-label="Next photograph" className="hidden p-4 text-primary-foreground/50 transition-colors hover:text-accent sm:block"><ChevronRight className="h-14 w-14" /></button>
        </div>
      </div>}
    </div>
  );
}