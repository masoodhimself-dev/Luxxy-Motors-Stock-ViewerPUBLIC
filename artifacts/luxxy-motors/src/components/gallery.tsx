import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getSafeImageUrl } from '@/lib/utils';
import { type CarImage } from '@/lib/stock-context';
import { cn } from '@/lib/utils';

interface GalleryProps {
  images: CarImage[];
  heroImage?: string;
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
      <div className="w-full aspect-video bg-muted rounded-xl flex items-center justify-center text-muted-foreground border">
        No images available
      </div>
    );
  }

  const currentImg = allImages[activeIndex];
  const url = getSafeImageUrl(currentImg);
  const caption = typeof currentImg === 'object' ? currentImg.caption : '';

  const renderImage = (imgUrl: string, idx: number, className: string = '') => (
    failedImages.has(idx) ? (
      <div className={cn("w-full h-full flex items-center justify-center bg-secondary text-muted-foreground", className)}>
        Image not available
      </div>
    ) : (
      <img
        src={imgUrl}
        alt={caption || `Vehicle image ${idx + 1}`}
        className={className}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedImages(prev => new Set(prev).add(idx))}
      />
    )
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Main Image */}
      <div 
        className="relative aspect-video sm:aspect-[16/9] w-full rounded-xl overflow-hidden bg-black cursor-pointer group"
        onClick={() => setIsFullscreen(true)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {renderImage(url, activeIndex, "w-full h-full object-cover transition-opacity duration-300")}
        
        {allImages.length > 1 && (
          <>
            <button 
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 backdrop-blur-sm"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 backdrop-blur-sm"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <div className="absolute bottom-4 right-4 px-3 py-1 rounded-full bg-black/60 text-white text-xs backdrop-blur-sm">
              {activeIndex + 1} / {allImages.length}
            </div>
          </>
        )}
        {caption && (
          <div className="absolute bottom-4 left-4 px-3 py-1 rounded bg-black/60 text-white text-sm backdrop-blur-sm max-w-[80%] truncate">
            {caption}
          </div>
        )}
      </div>

      {/* Thumbnails */}
      {allImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar snap-x">
          {allImages.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setActiveIndex(idx)}
              className={cn(
                "relative h-20 w-32 shrink-0 rounded-lg overflow-hidden snap-start transition-all",
                activeIndex === idx ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100"
              )}
            >
              {renderImage(getSafeImageUrl(img), idx, "w-full h-full object-cover")}
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center animate-in fade-in duration-200">
          <button 
            onClick={() => setIsFullscreen(false)}
            className="absolute top-6 right-6 text-white/70 hover:text-white z-50 p-2"
          >
            <X className="w-8 h-8" />
          </button>
          
          <div className="w-full max-w-7xl px-4 flex items-center justify-between">
            <button 
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              className="p-4 text-white/50 hover:text-white hidden sm:block"
            >
              <ChevronLeft className="w-12 h-12" />
            </button>
            
            <div 
              className="relative w-full max-h-[90vh] flex justify-center flex-col items-center"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {renderImage(url, activeIndex, "max-w-full max-h-[85vh] object-contain select-none")}
              {caption && <p className="text-white/80 mt-4 text-lg">{caption}</p>}
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              className="p-4 text-white/50 hover:text-white hidden sm:block"
            >
              <ChevronRight className="w-12 h-12" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
