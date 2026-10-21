import { VehicleCall } from '@/components/vehicle-call';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { responsiveVehicleImage, retryOriginalImage } from "@/lib/responsive-vehicle-image";
import { orderVehiclePhotos, photoGroup, type PhotoGroup } from "@/lib/vehicle-photography";
import { useState, useMemo, useRef, useEffect, useId, type ReactNode, type MouseEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, Maximize2, Mail, LayoutGrid, RotateCw, Calendar, ArrowRight, ZoomIn, ZoomOut } from '@/components/icons';
import { recordBookingIntent } from '@/lib/cta-helpers';
import { getSafeImageUrl, cn } from '@/lib/utils';
import { type Car, type CarImage } from '@/lib/stock-context';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Link } from 'wouter';
import './gallery-overview.css';

export interface GalleryProps {
  video?: { url: string; preview?: boolean };
  initialVideo?: boolean;
  car?: Car;
  images: CarImage[];
  heroImage?: string | null;
  vehicleLabel?: string;
  customerView?: boolean;
  customerActions?: { bookingHref?: string; enquiryHref?: string; onEnquiry?: () => void; call?: ReactNode };
}
function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({ car, images, heroImage, vehicleLabel = 'Vehicle', customerView = false, customerActions, video, initialVideo = false }: GalleryProps) {
  const [videoSelected, setVideoSelected] = useState(initialVideo);
  const showingVideo = Boolean(video && videoSelected);
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [interestOpen, setInterestOpen] = useState(false);
  const interestShown = useRef(false);
  const interestHeading = useRef<HTMLHeadingElement>(null);
  const inlinePhoto = useRef<HTMLDivElement>(null);
  const fullscreenPhoto = useRef<HTMLDivElement>(null);
  const interestHeadingId = useId();
  const hasCustomerActions = Boolean(customerActions?.bookingHref || customerActions?.enquiryHref || customerActions?.call);
  const [overviewFocusIndex, setOverviewFocusIndex] = useState(0);
  const messageRequested = useRef(false);
  const inlineEnquiryRequested = useRef(false);
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overviewRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const overviewToggleRef = useRef<HTMLButtonElement | null>(null);
  const failedUrls = useRef(new Set<string>());
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<PhotoGroup | 'All'>('All');
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const availableImages = useMemo(
    () => orderVehiclePhotos(images, heroImage).filter(image => !failedImages.has(getSafeImageUrl(image))),
    [images, heroImage, failedImages],
  );
  const allImages = useMemo(() => selectedGroup === 'All' ? availableImages : availableImages.filter(image => photoGroup(image) === selectedGroup), [availableImages, selectedGroup]);
  const index = Math.min(activeIndex, Math.max(0, allImages.length - 1));
  const [loadedUrl, setLoadedUrl] = useState('');
  const activeUrl = getSafeImageUrl(allImages[index]);
  // Only an explicit photo selection can open this. Filtering and failed-image
  // recovery must never interrupt browsing, and it appears once per vehicle visit.
  const selectPhoto = (target: number) => {
    setVideoSelected(false);
    const restoreFocus = interestOpen && document.activeElement === interestHeading.current;
    setInterestOpen(false);
    setZoomed(false);
    setActiveIndex(target);
    if (customerView && car && hasCustomerActions && !interestShown.current && allImages.length >= 10 && target === 9) {
      interestShown.current = true;
      setInterestOpen(true);
      return true;
    }
    if (restoreFocus) requestAnimationFrame(() => (open ? fullscreenPhoto : inlinePhoto).current?.focus({ preventScroll: true }));
    return false;
  };
  const keepViewing = () => {
    swiped.current = false;
    touchStart.current = null;
    setInterestOpen(false);
    requestAnimationFrame(() => (open ? fullscreenPhoto : inlinePhoto).current?.focus({ preventScroll: true }));
  };
  const contactFromPrompt = () => {
    messageRequested.current = open;
    swiped.current = false;
    setInterestOpen(false);
    setOverview(false);
    setOpen(false);
  };
  const requestEnquiry = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (customerActions?.onEnquiry) {
      event.preventDefault();
      if (open) inlineEnquiryRequested.current = true;
      else requestAnimationFrame(customerActions.onEnquiry);
    }
    contactFromPrompt();
  };
  useEffect(() => {
    if (interestOpen && !overview) interestHeading.current?.focus({ preventScroll: true });
  }, [interestOpen, open, overview]);
  useEffect(() => {
    const frame = fullscreenPhoto.current;
    if (!frame) return;
    frame.scrollLeft = zoomed ? (frame.scrollWidth - frame.clientWidth) / 2 : 0;
    frame.scrollTop = zoomed ? (frame.scrollHeight - frame.clientHeight) / 2 : 0;
    pan.current = null;
    if (zoomed) frame.focus({ preventScroll: true });
  }, [zoomed, activeUrl, open]);
  const toggleZoom = () => {
    setInterestOpen(false);
    setZoomed(value => !value);
    touchStart.current = null;
    swiped.current = false;
  };
  const retryPhotos = () => {
    failedUrls.current.clear();
    setFailedImages(new Set());
    setLoadedUrl('');
    setActiveIndex(0);
    setSelectedGroup('All');
  };
  useEffect(() => {
    if (selectedGroup !== 'All' && !allImages.length && availableImages.length) {
      setSelectedGroup('All');
      setActiveIndex(0);
    }
  }, [selectedGroup, allImages.length, availableImages.length]);
  const showOverview = () => {
    setInterestOpen(false);
    setZoomed(false);
    setOverviewFocusIndex(index);
    setOverview(true);
    requestAnimationFrame(() => {
      overviewRefs.current[index]?.focus({ preventScroll: true });
      overviewRefs.current[index]?.scrollIntoView({ block: 'nearest' });
    });
  };
  const showViewer = (imageIndex = index) => {
    const prompted = selectPhoto(imageIndex);
    setOverview(false);
    if (!prompted) requestAnimationFrame(() => overviewToggleRef.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    // Only warm neighbours after the main photograph has finished loading.
    if (!activeUrl || loadedUrl !== activeUrl || allImages.length < 2) return;
    const neighbours = [...new Set([(index + 1) % allImages.length, (index + allImages.length - 1) % allImages.length])];
    const requests = neighbours.map(i => {
      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = 'low';
      image.referrerPolicy = 'no-referrer';
      image.src = getSafeImageUrl(allImages[i]);
      return image;
    });
    return () => { requests.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [activeUrl, loadedUrl, allImages, index]);
  useEffect(() => {
    const button = thumbnailRefs.current[index];
    const row = button?.parentElement;
    if (!button || !row) return;
    // Move the strip without unexpectedly scrolling the customer down the page.
    const left = button.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (left + button.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + button.offsetWidth - row.clientWidth;
  }, [index]);
  const previous = () => selectPhoto((index + allImages.length - 1) % allImages.length);
  const next = () => selectPhoto((index + 1) % allImages.length);
  const touchHandlers = {
    onTouchStart: (event: React.TouchEvent) => {
      if (open && zoomed) { touchStart.current = null; return; }
      if (event.target instanceof Element && event.target.closest('a,button')) { touchStart.current = null; return; }
      if (event.touches.length !== 1) { touchStart.current = null; return; }
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      swiped.current = false;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = touchStart.current;
      if (start) {
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2 && allImages.length > 1) {
          swiped.current = true;
          if (dx < 0) next(); else previous();
        }
      }
      touchStart.current = null;
    },
    onTouchCancel: () => { touchStart.current = null; swiped.current = false; },
  };
  const groups = (["Exterior", "Interior", "Details", "Other"] as const)
    .filter(group => availableImages.some(image => photoGroup(image) === group));
  const groupNavigation = () => groups.some(group => group !== 'Other') && groups.length > 1 && (
    <div className="vehicle-photo-sections mt-3 flex gap-1 overflow-x-auto overscroll-x-contain border-b border-border" aria-label="Photograph sections">
      {(['All', ...groups] as const).map(group => <button type="button" key={group} aria-label={group === 'All' ? 'All photographs' : group === "Other" ? "More photos" : group} aria-pressed={selectedGroup === group}
        onClick={() => {
          setInterestOpen(false);
          setZoomed(false);
          setSelectedGroup(group);
          setActiveIndex(0);
          setOverviewFocusIndex(0);
        }}
        className={cn('min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-xs', selectedGroup === group ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>
        {group === "Other" ? "More photos" : group} ({group === 'All' ? availableImages.length : availableImages.filter(image => photoGroup(image) === group).length})
      </button>)}
    </div>
  );
  const renderImage = (
    imageIndex: number,
    className: string,
    eager = false,
    sizes = eager ? "(max-width: 1023px) 100vw, 900px" : "120px",
  ) => {
    const url = getSafeImageUrl(allImages[imageIndex]);
    const ImageElement = eager ? motion.img : 'img';
    const content = (
      <ImageElement
        {...(eager ? { initial: { opacity: reduceMotion ? 1 : 0, scale: reduceMotion ? 1 : 1.025 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 1 }, transition: { duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } : {})}
        key={url}
        src={url}
        {...responsiveVehicleImage(url, sizes)}
        decoding="async"
        draggable={false}
        fetchPriority={eager ? "high" : "low"}
        alt={imageCaption(allImages[imageIndex]) || `${vehicleLabel} — photograph ${imageIndex + 1}`}
        className={className}
        loading={eager ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer"
        onLoad={eager ? () => setLoadedUrl(url) : undefined}
        onError={(event) => {if (!retryOriginalImage(event.currentTarget)) {
          // The same photo may fail in the strip and overview. Remove it once,
          // preserving the selected photo even when several failures arrive together.
          if (failedUrls.current.has(url)) return;
          failedUrls.current.add(url);
          const remaining = allImages.filter(image => !failedUrls.current.has(getSafeImageUrl(image)));
          const selectedIndex = remaining.findIndex(image => getSafeImageUrl(image) === activeUrl);
          setActiveIndex(selectedIndex < 0 ? Math.min(index, Math.max(0, remaining.length - 1)) : selectedIndex);
          setFailedImages((prev) => new Set(prev).add(url));
        }}}
      />
    );
    return eager ? <AnimatePresence initial={false} mode="popLayout">{content}</AnimatePresence> : content;
  };
  const arrowClass =
    'photo-glass-control grid shrink-0 place-items-center';
  const interestPrompt = () => (
    <section className="vehicle-gallery-interest" aria-labelledby={interestHeadingId}
      onKeyDown={event => {
        // A call dialog is portaled outside this panel. Let it handle its own keys.
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); keepViewing(); }
      }}>
      <div className="vehicle-gallery-interest-content">
        <h2 id={interestHeadingId} ref={interestHeading} tabIndex={-1}>Like what you see?</h2>
        <p>Fancy a closer look? Pop in for a test drive or have a chat.</p>
        <div className="vehicle-gallery-interest-actions">
          {customerActions?.bookingHref && <Link href={customerActions.bookingHref} className="vehicle-gallery-interest-action vehicle-gallery-interest-primary" onClick={() => {
            recordBookingIntent({ source: 'vehicle_gallery', vehicleContext: true });
            contactFromPrompt();
          }}><Calendar aria-hidden="true" />Book a Test Drive<ArrowRight aria-hidden="true" /></Link>}
          <div className="vehicle-gallery-interest-secondary">
            {customerActions?.enquiryHref && <Link href={customerActions.enquiryHref} className="vehicle-gallery-interest-action" onClick={requestEnquiry}><Mail aria-hidden="true" />Ask a question</Link>}
            {customerActions?.call}
          </div>
        </div>
        <button type="button" className="vehicle-gallery-interest-continue" onClick={keepViewing}>Keep browsing<ChevronRight aria-hidden="true" /></button>
      </div>
    </section>
  );
  if (!allImages.length && !video)
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
        <Camera className="h-8 w-8" />
        {failedImages.size > 0 ? <><p className="text-sm" role="status">Photos couldn’t be loaded</p><button type="button" onClick={retryPhotos} className="inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium underline underline-offset-4"><RotateCw className="h-4 w-4" aria-hidden="true" />Try photos again</button></> : <p className="text-sm">Photographs to follow</p>}
      </div>
    );
  return (
    <Dialog open={open} onOpenChange={value => {
      setOpen(value);
      if (!value) { setInterestOpen(false); setZoomed(false); setOverview(false); swiped.current = false; touchStart.current = null; }
    }}>
      <div className="min-w-0" id={video ? "walkaround" : undefined}>
        {video && <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Vehicle photos and video">
          <button type="button" aria-pressed={!showingVideo} onClick={() => setVideoSelected(false)} className={cn('inline-flex min-h-11 items-center gap-2 rounded-sm border px-4 text-sm font-medium', !showingVideo ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground')}><Camera className="h-4 w-4" aria-hidden="true" />Photos{allImages.length > 0 ? ` (${allImages.length})` : ''}</button>
          <button type="button" aria-pressed={showingVideo} onClick={() => { setInterestOpen(false); setVideoSelected(true); }} className={cn('inline-flex min-h-11 items-center gap-2 rounded-sm border px-4 text-sm font-medium', showingVideo ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground')}><svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M4 5h10a2 2 0 0 1 2 2v2l5-3v12l-5-3v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg>Video</button>
        </div>}
        {showingVideo ? <div className="relative aspect-[4/3] overflow-hidden rounded-sm bg-black"><video aria-label={`${vehicleLabel} walkaround video`} className="h-full w-full object-contain" controls playsInline preload="none" poster={heroImage || undefined} src={video!.url} /></div> : <>
        <div className="vehicle-gallery-frame">
        <div
          ref={inlinePhoto} tabIndex={-1}
          className={cn('relative aspect-[4/3] overflow-hidden rounded-sm bg-muted touch-pan-y touch-pinch-zoom', interestOpen && !open && 'vehicle-gallery-interest-active')}
          {...touchHandlers}
        >
          {!allImages.length && <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Photographs to follow</p>}
          {renderImage(
            index,
            "gallery-photo absolute inset-0 h-full w-full object-contain",
            true,
          )}
          {allImages.length > 0 && loadedUrl !== activeUrl && <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-3 py-2 text-xs text-white" role="status">Loading photo…</span>}
          {allImages.length > 0 && !(interestOpen && !open) && <DialogTrigger asChild>
            <button
              type="button"
              aria-label="View gallery fullscreen"
              onClick={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; } }}
              className="absolute inset-0 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-sm bg-black/70 px-3 py-2 text-xs text-white">
                <Maximize2 className="h-4 w-4" />
                View all {allImages.length} photos
              </span>
            </button>
          </DialogTrigger>}
          {allImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={previous}
                aria-label="Previous photograph"
                className={cn(arrowClass, 'gallery-browse-arrow absolute left-3 top-1/2 -translate-y-1/2')}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Next photograph"
                className={cn(arrowClass, 'gallery-browse-arrow absolute right-3 top-1/2 -translate-y-1/2')}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
          {interestOpen && !open && interestPrompt()}
        </div>
        </div>
        <div
          className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{imageCaption(allImages[index]) || 'Vehicle gallery'}</span>
          <span>
            {allImages.length ? `${index + 1} / ${allImages.length} photographs` : 'No photographs yet'}
          </span>
        </div>
        {failedImages.size > 0 && <p className="mt-2 text-xs text-muted-foreground">{failedImages.size} {failedImages.size === 1 ? 'photo couldn’t' : 'photos couldn’t'} be loaded. <button type="button" onClick={retryPhotos} className="min-h-11 px-2 font-medium underline underline-offset-4">Retry photos</button></p>}
        </>}
        {showingVideo && <p className="mt-3 text-xs text-muted-foreground">{video?.preview ? "Local sample video · not footage of this car." : "Car walkaround"}</p>}
        {!showingVideo && groupNavigation()}
        {!showingVideo && allImages.length > 1 && (
          <div
            className="vehicle-thumbnail-grid mt-3 flex gap-2"
            aria-label="Choose photograph"
          >
            {allImages.map((image, i) => {
              return (
              <button
                key={getSafeImageUrl(image)}
                type="button"
                aria-label={`Show photograph ${i + 1} of ${allImages.length}`}
                aria-current={i === index}
                ref={(element) => { thumbnailRefs.current[i] = element; }}
                tabIndex={i === index ? 0 : -1}
                onKeyDown={(event) => {
                  const target = event.key === 'ArrowRight' ? (i + 1) % allImages.length
                    : event.key === 'ArrowLeft' ? (i + allImages.length - 1) % allImages.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? allImages.length - 1 : null;
                  if (target === null) return;
                  event.preventDefault();
                  if (selectPhoto(target)) return;
                  requestAnimationFrame(() => {
                    thumbnailRefs.current[target]?.focus({ preventScroll: true });
                    thumbnailRefs.current[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  });
                }}
                onClick={() => selectPhoto(i)}
                className={cn(
                  'aspect-[4/3] bg-muted overflow-hidden rounded-sm border-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  i === index ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100',
                )}
              >
                {renderImage(i, 'h-full w-full object-contain')}
              </button>
            ); })}
          </div>
        )}
      </div>
      <DialogContent
        className={cn('vehicle-lightbox', customerView && 'customer-vehicle-lightbox', overview && 'is-gallery-overview', zoomed && 'is-gallery-zoomed', interestOpen && 'has-gallery-interest')}
        overlayClassName={customerView ? 'vehicle-gallery-backdrop' : undefined}
        onCloseAutoFocus={event => {
          if (!messageRequested.current) return;
          event.preventDefault();
          messageRequested.current = false;
          if (inlineEnquiryRequested.current) {
            inlineEnquiryRequested.current = false;
            if (customerActions?.onEnquiry) requestAnimationFrame(customerActions.onEnquiry);
          }
        }}
        aria-describedby={undefined}
        onEscapeKeyDown={event => {
          if (interestOpen) { event.preventDefault(); keepViewing(); }
          else if (zoomed) { event.preventDefault(); setZoomed(false); }
        }}
        onKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== event.currentTarget) return;
          if (overview) return;
          if (zoomed && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            const frame = fullscreenPhoto.current;
            if (frame) { frame.scrollLeft += event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : 0; frame.scrollTop += event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0; }
            return;
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            next();
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            previous();
          }
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            selectPhoto(event.key === 'Home' ? 0 : allImages.length - 1);
          }
        }}
      >
        <DialogTitle className="sr-only">Vehicle image gallery</DialogTitle>
        {customerView && <div className="vehicle-gallery-toolbar">
          <span>{overview ? 'All photos' : 'Vehicle photos'} <span className="vehicle-gallery-toolbar-count">{allImages.length}</span></span>
          <div className="vehicle-gallery-toolbar-actions">
          {!overview && <button type="button" className="vehicle-gallery-overview-toggle" onClick={toggleZoom} aria-pressed={zoomed} aria-label={zoomed ? 'Zoom out' : 'Zoom in'}>
            {zoomed ? <ZoomOut aria-hidden="true" className="h-4 w-4" /> : <ZoomIn aria-hidden="true" className="h-4 w-4" />}<span>{zoomed ? 'Zoom out' : 'Zoom in'}</span>
          </button>}
          <button type="button" ref={overviewToggleRef} aria-pressed={overview} className="vehicle-gallery-overview-toggle"
            onClick={() => overview ? showViewer() : showOverview()}>
            {overview ? <ChevronLeft className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            {overview ? 'Back to photo' : 'All photos'}
          </button>
          </div>
        </div>}
        {groupNavigation()}
        {customerView && overview ? <div className="vehicle-gallery-overview" role="region" aria-label={`All ${allImages.length} photographs`}>
          <div className="vehicle-gallery-overview-grid" aria-label="Choose a photo to view fullscreen">
            {allImages.map((image, i) => <button key={getSafeImageUrl(image)} type="button"
              className="vehicle-gallery-overview-photo" aria-label={`View photograph ${i + 1} of ${allImages.length}${imageCaption(image) ? `: ${imageCaption(image)}` : ''}`}
              aria-current={i === index} tabIndex={i === Math.min(overviewFocusIndex, allImages.length - 1) ? 0 : -1}
              ref={element => { overviewRefs.current[i] = element; }} onClick={() => showViewer(i)}
              onKeyDown={event => {
                const columns = Math.max(1, getComputedStyle(event.currentTarget.parentElement!).gridTemplateColumns.split(' ').filter(Boolean).length);
                const target = event.key === 'ArrowRight' ? Math.min(i + 1, allImages.length - 1)
                  : event.key === 'ArrowLeft' ? Math.max(i - 1, 0)
                  : event.key === 'ArrowDown' ? Math.min(i + columns, allImages.length - 1)
                  : event.key === 'ArrowUp' ? Math.max(i - columns, 0)
                  : event.key === 'Home' ? 0 : event.key === 'End' ? allImages.length - 1 : null;
                if (target === null) return;
                event.preventDefault();
                setOverviewFocusIndex(target);
                requestAnimationFrame(() => {
                  overviewRefs.current[target]?.focus({ preventScroll: true });
                  overviewRefs.current[target]?.scrollIntoView({ block: 'nearest' });
                });
              }}>
              {renderImage(i, 'h-full w-full object-contain', false, '(min-width: 1100px) 230px, (min-width: 640px) 220px, 50vw')}
              <span className="vehicle-gallery-overview-number" aria-hidden="true">{i + 1}</span>
              {i === index && <span className="vehicle-gallery-overview-selected" aria-hidden="true">Selected</span>}
            </button>)}
          </div>
        </div> : <>
        <div ref={fullscreenPhoto} tabIndex={-1} className={cn('vehicle-lightbox-photo min-w-0 touch-pan-y touch-pinch-zoom', interestOpen && 'vehicle-gallery-interest-active', zoomed && 'vehicle-photo-zoomed')} {...touchHandlers}
          onDoubleClick={customerView ? toggleZoom : undefined}
          onPointerDown={event => {
            if (!zoomed || event.pointerType !== 'mouse' || event.button !== 0) return;
            pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={event => {
            if (!pan.current) return;
            event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
            event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
          }}
          onPointerUp={event => {
            pan.current = null;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { pan.current = null; }}>
          <div className="vehicle-photo-zoom-stage">{renderImage(index, 'h-full max-h-full w-full object-contain', true, zoomed ? '200vw' : '100vw')}</div>
          {interestOpen && open && interestPrompt()}
        </div>
        <div className="vehicle-lightbox-navigation flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={previous}
            aria-label="Previous photograph"
            className={arrowClass}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="text-center text-sm" aria-live="polite">
            {index + 1} / {allImages.length}
            <span className="ml-3 text-muted-foreground">
              {imageCaption(allImages[index])}
            </span>
          </p>
          <button type="button" onClick={next} aria-label="Next photograph" className={arrowClass}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        </>}
        {car && !interestOpen && <div className="vehicle-lightbox-contact" aria-label="Contact about this vehicle">
          <VehicleCall car={car} buttonLabel="Call Us" className="vehicle-lightbox-contact-button" />
          <Link href={customerActions?.enquiryHref ?? `/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`} className="vehicle-lightbox-contact-button" onClick={requestEnquiry}>
            <Mail className="h-5 w-5" /> Message
          </Link>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
