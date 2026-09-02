import { useState, useEffect, useCallback } from 'react';
import { Camera, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getSafeImageUrl } from '@/lib/utils';
import { type CarImage } from '@/lib/stock-context';
import { cn } from '@/lib/utils';

interface GalleryProps {
  images: CarImage[];
  heroImage?: string | null;
}

function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({ images, heroImage }: GalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  // Consolidate images: put hero first if it's not already in the array
  const allImages = [...images];
  if (heroImage && !allImages.find(img => getSafeImageUrl(img) === heroImage)) {
    allImages.unshift(heroImage);
  }

  const handleNext = useCallback(() => {
    setActiveIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
  }, [allImages.length]);

  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
  }, [allImages.length]);

  const [touchStart, setTouchStart] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    
    if (Math.abs(diff) > 50) {
      if (diff > 0) handleNext();
      else handlePrev();
    }
    setTouchStart(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, isFullscreen]);

  if (allImages.length === 0) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 border border-border/70 bg-secondary/60 text-muted-foreground">
        <Camera className="h-7 w-7 opacity-40" />
        <span className="luxxy-label">No images available</span>
      </div>
    );
  }

  const currentImg = allImages[activeIndex];
  const url = getSafeImageUrl(currentImg);
  const caption = imageCaption(currentImg);

  const arrowButton =
    'absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center bg-primary/85 text-primary-foreground opacity-0 backdrop-blur-sm transition-all hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100';

  const renderImage = (imgUrl: string, idx: number, className: string = '') => (
    failedImages.has(idx) ? (
      <div className={cn('flex h-full w-full items-center justify-center bg-secondary text-muted-foreground', className)}>
        <span className="luxxy-label">Image not available</span>
      </div>
    ) : (
      <img
        src={imgUrl}
        alt={imageCaption(allImages[idx]) || `Vehicle image ${idx + 1}`}
        className={className}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedImages(prev => new Set(prev).add(idx))}
      />
    )
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Main Image */}
      <div 
        className="group relative aspect-video w-full cursor-zoom-in overflow-hidden border border-border/70 bg-secondary/60 sm:aspect-[16/9]"
        onClick={() => setIsFullscreen(true)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {renderImage(url, activeIndex, 'h-full w-full object-cover transition-opacity duration-300')}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-primary/55 via-primary/5 to-transparent" />

        {allImages.length > 1 && (
          <>
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              aria-label="Previous photograph"
              className={cn(arrowButton, 'left-0')}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              aria-label="Next photograph"
              className={cn(arrowButton, 'right-0')}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 bg-primary/85 px-2.5 py-1 font-mono text-[10px] font-bold text-primary-foreground backdrop-blur-sm">
              <Camera className="h-3 w-3" />
              {activeIndex + 1} / {allImages.length}
            </span>
          </>
        )}
        {caption && (
          <span className="pointer-events-none absolute bottom-3 left-3 max-w-[80%] truncate bg-primary/85 px-3 py-1.5 text-[11px] font-semibold tracking-[.04em] text-primary-foreground backdrop-blur-sm">
            {caption}
          </span>
        )}
      </div>

      {/* Thumbnails */}
      {allImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar snap-x">
          {allImages.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              aria-label={`Show photograph ${idx + 1} of ${allImages.length}`}
              aria-current={activeIndex === idx}
              className={cn(
                'relative h-[4.5rem] w-28 shrink-0 snap-start overflow-hidden border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                activeIndex === idx
                  ? 'border-accent'
                  : 'border-border/70 opacity-55 hover:opacity-100',
              )}
            >
              {renderImage(getSafeImageUrl(img), idx, 'h-full w-full object-cover')}
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-primary/97 backdrop-blur-md animate-in fade-in duration-200">
          <button 
            type="button"
            onClick={() => setIsFullscreen(false)}
            aria-label="Close photograph viewer"
            className="absolute right-5 top-5 z-50 grid h-11 w-11 place-items-center border border-primary-foreground/20 text-primary-foreground/70 transition-colors hover:border-accent hover:text-accent"
          >
            <X className="h-6 w-6" />
          </button>
          
          <div className="flex w-full max-w-7xl items-center justify-between px-4">
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              aria-label="Previous photograph"
              className="hidden p-4 text-primary-foreground/50 transition-colors hover:text-accent sm:block"
            >
              <ChevronLeft className="h-10 w-10" />
            </button>
            
            <div 
              className="relative flex max-h-[90vh] w-full flex-col items-center justify-center"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {renderImage(url, activeIndex, 'max-h-[82vh] max-w-full select-none object-contain')}
              <p className="mt-5 flex items-center gap-3 font-mono text-[11px] font-bold text-primary-foreground/60">
                <span>{activeIndex + 1} / {allImages.length}</span>
                {caption && <span className="font-sans text-sm font-semibold text-primary-foreground/85">{caption}</span>}
              </p>
            </div>

            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              aria-label="Next photograph"
              className="hidden p-4 text-primary-foreground/50 transition-colors hover:text-accent sm:block"
            >
              <ChevronRight className="h-10 w-10" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
