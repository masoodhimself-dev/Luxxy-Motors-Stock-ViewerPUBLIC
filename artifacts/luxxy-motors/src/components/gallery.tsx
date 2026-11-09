import { VehicleCall } from '@/components/vehicle-call';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { responsiveVehicleImage, retryOriginalImage } from "@/lib/responsive-vehicle-image";
import { orderVehiclePhotos, photoGroup, getPhotoShortcuts, type PhotoGroup } from "@/lib/vehicle-photography";
import { useState, useMemo, useRef, useEffect, useId, type MouseEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, Maximize2, Mail, LayoutGrid, RotateCw, ZoomIn, ZoomOut } from '@/components/icons';
import { getSafeImageUrl, cn } from '@/lib/utils';
import { type Car, type CarImage } from '@/lib/stock-context';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Link } from 'wouter';
import './gallery-overview.css';
import { shouldPrefetchVehiclePhotos } from '@/lib/photo-connection';

export interface GalleryProps {
  car?: Car;
  images: CarImage[];
  heroImage?: string | null;
  vehicleLabel?: string;
  customerView?: boolean;
  hideInlineThumbnails?: boolean;
  customerActions?: { enquiryHref?: string; onEnquiry?: () => void };
}
function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({
  car, images, heroImage, vehicleLabel = 'Vehicle', customerView = false,
  hideInlineThumbnails = false, customerActions,
}: GalleryProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const zoomed = zoomScale > 1;
  const setZoomed = (value: boolean) => setZoomScale(value ? 2 : 1);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const fullscreenPhoto = useRef<HTMLDivElement>(null);
  const counterId = useId();
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
  const selectPhoto = (target: number) => {
    setZoomed(false);
    pinch.current = null;
    pan.current = null;
    setActiveIndex(target);
  };
  const closeForContact = () => {
    messageRequested.current = open;
    swiped.current = false;
    setZoomed(false);
    setOverview(false);
    setOpen(false);
  };
  const requestEnquiry = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (customerActions?.onEnquiry) {
      event.preventDefault();
      if (open) inlineEnquiryRequested.current = true;
      else requestAnimationFrame(() => customerActions.onEnquiry?.());
    }
    closeForContact();
  };
  useEffect(() => {
    const frame = fullscreenPhoto.current;
    if (!frame) return;
    frame.scrollLeft = zoomed ? (frame.scrollWidth - frame.clientWidth) / 2 : 0;
    frame.scrollTop = zoomed ? (frame.scrollHeight - frame.clientHeight) / 2 : 0;
    pan.current = null;
    if (zoomed) frame.focus({ preventScroll: true });
  }, [zoomed, activeUrl, open]);
  const toggleZoom = () => {
    setZoomed(!zoomed);
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
    setZoomed(false);
    setOverviewFocusIndex(index);
    setOverview(true);
    requestAnimationFrame(() => {
      overviewRefs.current[index]?.focus({ preventScroll: true });
      overviewRefs.current[index]?.scrollIntoView({ block: 'nearest' });
    });
  };
  const showViewer = (imageIndex = index) => {
    selectPhoto(imageIndex);
    setOverview(false);
    requestAnimationFrame(() => overviewToggleRef.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    // Only warm neighbours after the main photograph has finished loading.
    if (!activeUrl || loadedUrl !== activeUrl || allImages.length < 2 || !shouldPrefetchVehiclePhotos(navigator)) return;
    const neighbours = [...new Set([(index + 1) % allImages.length, (index + allImages.length - 1) % allImages.length])];
    const requests = neighbours.map(i => {
      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = 'low';
      image.referrerPolicy = 'no-referrer';
      const source = getSafeImageUrl(allImages[i]);
      const responsive = responsiveVehicleImage(source, '(min-width: 1024px) 65vw, 100vw');
      if (responsive.srcSet) image.srcset = responsive.srcSet;
      if (responsive.sizes) image.sizes = responsive.sizes;
      image.src = source;
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
  }, [index, hideInlineThumbnails]);
  const previous = () => selectPhoto((index + allImages.length - 1) % allImages.length);
  const next = () => selectPhoto((index + 1) % allImages.length);
  const touchHandlers = {
    onTouchStart: (event: React.TouchEvent) => {
      if (open && event.touches.length === 2) {
        pinch.current = { distance: Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY), scale: zoomScale };
        touchStart.current = null;
        pan.current = null;
        swiped.current = true;
        return;
      }
      if (open && zoomed && event.touches.length === 1) {
        const frame = fullscreenPhoto.current;
        if (frame) pan.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, left: frame.scrollLeft, top: frame.scrollTop };
        touchStart.current = null;
        return;
      }
      if (event.target instanceof Element && event.target.closest('a,button') && !event.target.closest('[data-gallery-open]')) { touchStart.current = null; return; }
      if (event.touches.length !== 1) { touchStart.current = null; return; }
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      swiped.current = false;
    },
    onTouchMove: (event: React.TouchEvent) => {
      if (!open) return;
      if (pinch.current && event.touches.length === 2) {
        const distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
        setZoomScale(Math.min(3, Math.max(1, pinch.current.scale * distance / Math.max(1, pinch.current.distance))));
      } else if (!pinch.current && pan.current && event.touches.length === 1 && fullscreenPhoto.current) {
        fullscreenPhoto.current.scrollLeft = pan.current.left - (event.touches[0].clientX - pan.current.x);
        fullscreenPhoto.current.scrollTop = pan.current.top - (event.touches[0].clientY - pan.current.y);
      }
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (pinch.current || (open && pan.current)) {
        if (!event.touches?.length) { pinch.current = null; pan.current = null; }
        touchStart.current = null;
        return;
      }
      const start = touchStart.current;
      if (start && event.changedTouches.length) {
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2 && allImages.length > 1) {
          swiped.current = true;
          if (dx < 0) next(); else previous();
        }
      }
      touchStart.current = null;
    },
    onTouchCancel: () => { touchStart.current = null; pinch.current = null; pan.current = null; swiped.current = false; },
  };
  const groups = (["Exterior", "Interior", "Details", "Condition"] as const)
    .filter(group => availableImages.some(image => photoGroup(image) === group));
  const groupNames = { All: 'All', Exterior: 'Outside', Interior: 'Inside', Details: 'Features', Condition: 'Condition', Other: 'More photos' };
  const shortcuts = getPhotoShortcuts(availableImages);
  const groupNavigation = () => groups.length > 0 && (
    <div className="vehicle-photo-sections" aria-label="Photograph sections">
      {(['All', ...groups] as const).map(group => <button type="button" key={group} aria-label={group === 'All' ? 'All photographs' : groupNames[group]} aria-pressed={selectedGroup === group}
        onClick={() => {
          setZoomed(false);
          setSelectedGroup(group);
          setActiveIndex(0);
          setOverviewFocusIndex(0);
        }}
        className={cn('min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-xs', selectedGroup === group ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>
        {groupNames[group]} <span>{group === 'All' ? availableImages.length : availableImages.filter(image => photoGroup(image) === group).length}</span>
      </button>)}
    </div>
  );
  const renderImage = (
    imageIndex: number,
    className: string,
    eager = false,
    sizes = eager ? "(max-width: 1023px) 100vw, 900px" : "120px",
    initialThumbnail = false,
  ) => {
    const url = getSafeImageUrl(allImages[imageIndex]);
    const ImageElement = eager ? motion.img : 'img';
    const content = (
      <ImageElement
        {...(eager ? { initial: { opacity: reduceMotion ? 1 : 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } : {})}
        key={url}
        src={url}
        {...responsiveVehicleImage(url, sizes)}
        decoding="async"
        draggable={false}
        fetchPriority={eager ? "high" : initialThumbnail ? "auto" : "low"}
        alt={imageCaption(allImages[imageIndex]) || `${vehicleLabel} — photograph ${imageIndex + 1}`}
        className={className}
        loading={eager || initialThumbnail ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer"
        onLoad={event => {
          event.currentTarget.dataset.photoReady = '';
          if (eager) setLoadedUrl(url);
        }}
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
  if (!allImages.length)
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
        <Camera className="h-8 w-8" />
        {failedImages.size > 0 ? <><p className="text-sm" role="status">Photos couldn’t be loaded</p><button type="button" onClick={retryPhotos} className="inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium underline underline-offset-4"><RotateCw className="h-4 w-4" aria-hidden="true" />Try photos again</button></> : <p className="text-sm">Photographs to follow</p>}
      </div>
    );
  return (
    <Dialog open={open} onOpenChange={value => {
      setOpen(value);
      if (!value) { setZoomed(false); setOverview(false); swiped.current = false; touchStart.current = null; pinch.current = null; pan.current = null; }
    }}>
      <div className={cn("vehicle-photo-gallery min-w-0", customerView && "is-customer-gallery")}>
        <div className="vehicle-gallery-frame">
        <div
          className="vehicle-gallery-image-stage relative aspect-[4/3] overflow-hidden rounded-sm bg-muted touch-pan-y touch-pinch-zoom"
          {...touchHandlers}
        >
          {!allImages.length && <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Photographs to follow</p>}
          {renderImage(
            index,
            "gallery-photo absolute inset-0 h-full w-full object-contain",
            true,
          )}
          {allImages.length > 0 && loadedUrl !== activeUrl && <span className="gallery-photo-loading pointer-events-none absolute inset-0 motion-safe:animate-pulse bg-muted"><span className="sr-only" role="status">Loading photo…</span></span>}
          {allImages.length > 0 && <DialogTrigger asChild>
            <button
              type="button"
              data-gallery-open
              aria-label="View gallery fullscreen"
              aria-describedby={customerView && !open ? counterId : undefined}
              onClick={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; } }}
              className="absolute inset-0 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="gallery-enlarge-icon" aria-hidden="true"><Maximize2 className="h-5 w-5" /></span>
            </button>
          </DialogTrigger>}
          {allImages.length > 1 && <div className="vehicle-gallery-inline-arrows">
            <button type="button" onClick={previous} aria-label="Previous photograph">
              <span className="vehicle-gallery-arrow-face" aria-hidden="true"><ChevronLeft className="h-5 w-5" /></span>
            </button>
            <button type="button" onClick={next} aria-label="Next photograph">
              <span className="vehicle-gallery-arrow-face" aria-hidden="true"><ChevronRight className="h-5 w-5" /></span>
            </button>
          </div>}
        </div>
        </div>
        <div className="vehicle-gallery-controls">
          <div className="vehicle-gallery-caption">
            {(!open || !customerView) && <span id={counterId} className="vehicle-gallery-position" aria-live="polite" aria-atomic="true">{index + 1} / {allImages.length}</span>}
            {imageCaption(allImages[index]) && <span className="vehicle-photo-caption">{imageCaption(allImages[index])}</span>}
          </div>
          <button type="button" className="vehicle-gallery-view-all" onClick={() => { setOpen(true); if (customerView) showOverview(); }}>
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />{allImages.length === 1 ? 'View photo' : `View all ${allImages.length} photos`}
          </button>
        </div>
        {imageCaption(allImages[index]) && <details className="vehicle-mobile-photo-details" key={activeUrl}><summary>Photo details</summary><p>{imageCaption(allImages[index])}</p></details>}
        {failedImages.size > 0 && <p className="mt-2 text-xs text-muted-foreground">{failedImages.size} {failedImages.size === 1 ? 'photo couldn’t' : 'photos couldn’t'} be loaded. <button type="button" onClick={retryPhotos} className="min-h-11 px-2 font-medium underline underline-offset-4">Retry photos</button></p>}
        {!hideInlineThumbnails && allImages.length > 1 && (
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
                  selectPhoto(target);
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
        {groupNavigation()}
        {shortcuts.length > 0 && <div className="vehicle-photo-shortcuts" aria-label="Photo shortcuts">
          <span>Show me</span>
          {shortcuts.map(shortcut => <button key={shortcut.label} type="button" onClick={() => {
            setSelectedGroup('All');
            selectPhoto(shortcut.index);
            setOverview(false);
            setOpen(true);
          }}>{shortcut.label}</button>)}
        </div>}
      </div>
      <DialogContent
        className={cn('vehicle-lightbox', customerView && 'customer-vehicle-lightbox', overview && 'is-gallery-overview', zoomed && 'is-gallery-zoomed')}
        overlayClassName={customerView ? 'vehicle-gallery-backdrop' : undefined}
        onCloseAutoFocus={event => {
          if (!messageRequested.current) return;
          event.preventDefault();
          messageRequested.current = false;
          if (inlineEnquiryRequested.current) {
            inlineEnquiryRequested.current = false;
            if (customerActions?.onEnquiry) requestAnimationFrame(() => customerActions.onEnquiry?.());
          }
        }}
        aria-describedby={undefined}
        onEscapeKeyDown={event => {
          if (zoomed) { event.preventDefault(); setZoomed(false); }
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
          <div className="vehicle-gallery-toolbar-title"><span>{vehicleLabel === 'Vehicle' ? 'Vehicle photos' : vehicleLabel}</span><span className="vehicle-gallery-toolbar-count" aria-live="polite" aria-atomic="true">{overview ? `${allImages.length} ${allImages.length === 1 ? 'photo' : 'photos'}` : `${index + 1} / ${allImages.length}`}</span></div>
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
        {overview ? <div className="vehicle-gallery-overview" role="region" aria-label={`All ${allImages.length} photographs`}>
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
              {renderImage(i, 'h-full w-full object-contain', false, '(min-width: 1100px) 230px, (min-width: 640px) 220px, 50vw', i < 6)}
              <span className="vehicle-gallery-thumbnail-status" aria-hidden="true">Loading photo…</span>
            </button>)}
          </div>
        </div> : <>
        <div ref={fullscreenPhoto} tabIndex={-1} className={cn('vehicle-lightbox-photo min-w-0 touch-pan-y touch-pinch-zoom', zoomed && 'vehicle-photo-zoomed')} {...touchHandlers}
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
          <div className="vehicle-photo-zoom-stage" style={{ width: `${zoomScale * 100}%`, height: `${zoomScale * 100}%` }}>{renderImage(index, 'h-full max-h-full w-full object-contain', true, zoomed ? '200vw' : '100vw')}</div>
        </div>
        <div className="vehicle-lightbox-navigation flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={previous}
            aria-label="Previous photograph"
            className={arrowClass}
            disabled={allImages.length < 2}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="text-center text-sm" aria-live="polite">
            {!customerView && <span>{index + 1} / {allImages.length}</span>}
            <span className="vehicle-lightbox-caption">
              {imageCaption(allImages[index])}
            </span>
          </p>
          <button type="button" onClick={next} aria-label="Next photograph" className={arrowClass} disabled={allImages.length < 2}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        </>}
        {car && <div className="vehicle-lightbox-contact" aria-label="Contact about this vehicle">
          <VehicleCall car={car} buttonLabel="Call us" className="vehicle-lightbox-contact-button" />
          {(!customerActions || customerActions.enquiryHref || customerActions.onEnquiry) && <Link href={customerActions?.enquiryHref ?? `/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`} className="vehicle-lightbox-contact-button" onClick={requestEnquiry}>
            <Mail className="h-5 w-5" /> Message
          </Link>}
        </div>}
      </DialogContent>
    </Dialog>
  );
}
