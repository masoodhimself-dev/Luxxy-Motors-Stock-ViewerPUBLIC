import { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Heart, MessageCircle, Phone, Scale, Share2 } from 'lucide-react';
import { ModernCarCard } from './_modern-CarCard';
import { ModernChrome } from './_modern-Chrome';
import { MockLink } from './_shared/Link';
import { Plate } from './_shared/Plate';
import { Car, cn, dealerConfig, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, isUKNumberPlate, stock, vehicleDisplayTitle, vehicleRegistration } from './_data';
import './_modern-theme.css';

const DETAIL_CAR_ID = '0781ad32-ee31-4b5a-98f4-a900a87104ad';

function ModernGallery({ car }: { car: Car }) {
  const images = [getSafeImageUrl(getThumbnailUrl(car)), ...(car.images || []).map(getSafeImageUrl)].filter((image, imageIndex, allImages): image is string => Boolean(image) && allImages.indexOf(image) === imageIndex);
  const [index, setIndex] = useState(0);
  const mainImage = images[index];
  return (
    <div className="min-w-0 max-w-full">
      <div className="modern-gallery-frame relative overflow-hidden bg-[hsl(var(--modern-panel))]">
        {images.length > 0 && <img src={mainImage} alt={`${vehicleDisplayTitle(car)} vehicle`} className="block h-full w-full" style={{ objectFit: 'cover' }} />}
        {images.length > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => setIndex((current) => (current - 1 + images.length) % images.length)} className="modern-focus absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-[hsl(var(--modern-ivory)/.88)] shadow-sm"><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" aria-label="Next photo" onClick={() => setIndex((current) => (current + 1) % images.length)} className="modern-focus absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-[hsl(var(--modern-ivory)/.88)] shadow-sm"><ChevronRight className="h-5 w-5" /></button>
          </>
        )}
      </div>
      {images.length > 1 && <div className="no-scrollbar flex gap-2 overflow-x-auto py-3">{images.map((image, photoIndex) => <button key={`${image}-${photoIndex}`} type="button" onClick={() => setIndex(photoIndex)} aria-label={`View photo ${photoIndex + 1}`} className={cn('modern-focus h-16 w-24 shrink-0 overflow-hidden', index === photoIndex ? 'ring-2 ring-[hsl(var(--modern-blue))] ring-offset-2' : 'opacity-60 hover:opacity-100')}><img src={image} alt="" className="h-full w-full object-cover" /></button>)}</div>}
    </div>
  );
}

export default function ModernDetail() {
  const car = stock.cars.find((candidate) => candidate.id === DETAIL_CAR_ID);
  const [saved, setSaved] = useState(false);
  const [bookingPreview, setBookingPreview] = useState(false);
  if (!car) return <ModernChrome currentPath={`/vehicle/${DETAIL_CAR_ID}`}><div className="mx-auto w-full max-w-[1320px] px-4 py-16">Vehicle unavailable.</div></ModernChrome>;

  const label = vehicleDisplayTitle(car);
  const registration = vehicleRegistration(car);
  const registrationYear = [car.registrationBand, car.registration].map((value) => value?.trim() || '').find((value) => value && !isUKNumberPlate(value)) || (car.year ? String(car.year) : 'Unknown');
  const specs = [
    ['Year', registrationYear],
    ['Mileage', car.mileage ? formatMileage(car.mileage) : car.mileageText || 'Unknown'],
    ['Fuel', car.fuel || '-'],
    ['Transmission', car.transmission || '-'],
    ['Body type', car.bodyType || '-'],
    ['Engine', car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : '-')],
    ['Colour', car.colour || '-'],
    ['Photos', `${car.imageCount || car.images?.length || 0} available`],
  ];
  return (
    <ModernChrome currentPath={`/vehicle/${DETAIL_CAR_ID}`}>
      <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <MockLink href="/#inventory" className="modern-focus flex min-h-11 items-center gap-1 rounded-sm px-1 text-sm text-[hsl(var(--modern-muted))] hover:text-[hsl(var(--modern-ink))]"><ChevronLeft className="h-4 w-4" /> Back to stock</MockLink>
          <div className="flex items-center gap-1">
            <button type="button" className="modern-focus grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--modern-muted))] hover:bg-[hsl(var(--modern-panel))]" aria-label="Share vehicle"><Share2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => setSaved((value) => !value)} aria-pressed={saved} className={cn('modern-focus grid h-11 w-11 place-items-center rounded-full hover:bg-[hsl(var(--modern-panel))]', saved && 'text-[hsl(var(--modern-blue))]')} aria-label="Save vehicle"><Heart className={cn('h-4 w-4', saved && 'fill-current')} /></button>
          </div>
        </div>

        <div className="mb-7 lg:hidden">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[hsl(var(--modern-blue))]">Vehicle details</p>
          <h1 className="modern-display text-3xl font-semibold leading-tight">{label}</h1>
          {(car.variant || car.trim) && <p className="mt-1 text-sm text-[hsl(var(--modern-muted))]">{car.variant || car.trim}</p>}
          <p className="mt-3 text-3xl font-semibold">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</p>
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_400px] xl:grid-cols-[minmax(0,1.55fr)_440px]">
          <div className="min-w-0">
            <ModernGallery car={car} />
            <section className="mt-10 border-t modern-rule pt-8 sm:mt-14 sm:pt-10">
              <div className="mb-6 flex items-end justify-between"><h2 className="modern-display text-2xl font-semibold">Vehicle details</h2><span className="text-xs text-[hsl(var(--modern-muted))]">From the live stock record</span></div>
              <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                {specs.map(([name, value]) => <div key={name} className="flex min-h-14 items-center justify-between gap-4 border-b modern-rule px-1 py-3 text-sm"><dt className="text-[hsl(var(--modern-muted))]">{name}</dt><dd className="text-right font-semibold">{value}</dd></div>)}
              </dl>
            </section>
          </div>

          <aside className="lg:sticky lg:top-[calc(var(--modern-header-height,4rem)+1.5rem)]">
            <div className="border modern-rule bg-[hsl(var(--modern-panel)/.46)] p-5 sm:p-7">
              <div className="hidden lg:block">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[hsl(var(--modern-blue))]">Vehicle details</p>
                <h1 className="modern-display text-4xl font-semibold leading-tight">{label}</h1>
                {(car.variant || car.trim) && <p className="mt-2 text-sm text-[hsl(var(--modern-muted))]">{car.variant || car.trim}</p>}
                <p className="mt-6 text-4xl font-semibold">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</p>
              </div>
              {registration && <div className="mt-5"><Plate size="sm" value={registration} className="w-[132px]" /></div>}
              <div className="mt-6 flex flex-col gap-3">
                <button type="button" onClick={() => setBookingPreview((value) => !value)} className="modern-focus flex min-h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--modern-blue))] px-5 text-sm font-semibold text-white hover:bg-[hsl(var(--modern-ink))]"><Calendar className="h-4 w-4" /> Book a Viewing <span className="text-[11px] font-normal opacity-75">Preview</span></button>
                {bookingPreview && <p role="status" className="border-l-2 border-[hsl(var(--modern-blue))] px-3 py-2 text-xs leading-5 text-[hsl(var(--modern-muted))]">Booking is a preview in this prototype — no request has been sent.</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="modern-focus flex min-h-12 items-center justify-center gap-2 rounded-full border modern-rule text-sm font-semibold hover:border-[hsl(var(--modern-ink))]"><Phone className="h-4 w-4" /> Call</button>
                  <button type="button" className="modern-focus flex min-h-12 items-center justify-center gap-2 rounded-full border modern-rule text-sm font-semibold hover:border-[hsl(var(--modern-ink))]"><MessageCircle className="h-4 w-4" /> Message</button>
                </div>
              </div>
              <p className="mt-6 border-t modern-rule pt-5 text-xs leading-5 text-[hsl(var(--modern-muted))]">{dealerConfig.identity.name} · {dealerConfig.address.city}, {dealerConfig.address.region}</p>
            </div>
          </aside>
        </div>
      </div>

      <section className="border-t modern-rule bg-[hsl(var(--modern-panel)/.6)] py-12 sm:py-16">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
          <div className="mb-7 flex items-end justify-between"><h2 className="modern-display text-2xl font-semibold">More from the showroom</h2><MockLink href="/#inventory" className="modern-focus rounded-sm px-1 text-sm font-semibold text-[hsl(var(--modern-blue))]">View all</MockLink></div>
          <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-4">{stock.cars.filter((candidate) => candidate.id !== DETAIL_CAR_ID).slice(0, 4).map((candidate) => <ModernCarCard key={candidate.id} car={candidate} />)}</div>
        </div>
      </section>
    </ModernChrome>
  );
}