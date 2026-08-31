import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, Camera, Car as CarIcon, CircleAlert, Clock3, Fuel, Gauge, Mail, MapPin, Phone, Settings2, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { useStock } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl } from '@/lib/utils';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'delivery', 'warranty', 'part_exchange'];
const headings: Record<EnquiryType, { eyebrow: string; title: string; description: string }> = {
  viewing: { eyebrow: 'Private showroom visit', title: 'Come and meet the car properly.', description: 'Choose a time that suits you. We will have the vehicle ready, warmed up and waiting.' },
  general: { eyebrow: 'Luxxy Motors concierge', title: 'Tell us what you need.', description: 'A direct line to the team behind the showroom. We will come back to you with a useful answer.' },
  delivery: { eyebrow: 'Nationwide delivery', title: 'Let’s get it to your door.', description: 'Share where you are and we will map out the simplest route to getting your next car home.' },
  warranty: { eyebrow: 'Added peace of mind', title: 'Ask us about cover.', description: 'We will talk you through the warranty options available for the vehicle you have in mind.' },
  part_exchange: { eyebrow: 'Part exchange', title: 'See what your current car is worth.', description: 'Tell us a little about your car and we will help you understand your options.' },
};

function vehicleName(vehicle: { title: string | null; make: string | null; model: string | null }) {
  return vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Selected vehicle';
}

export default function Enquire() {
  const { stock, isLoading, error } = useStock();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedType = params.get('type') as EnquiryType | null;
  const type = requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general';
  const vehicleId = params.get('vehicleId');
  const vehicle = stock?.cars.find((car) => car.id === vehicleId);
  const copy = headings[type];
  const selectedVehicleName = vehicle ? vehicleName(vehicle) : 'your next car';
  const vehicleImage = vehicle ? getThumbnailUrl(vehicle) : '';
  const vehicleHighlights = vehicle
    ? [
        { label: 'Year', value: vehicle.year ? String(vehicle.year) : null, icon: CalendarDays },
        { label: 'Mileage', value: vehicle.mileage ? formatMileage(vehicle.mileage) : vehicle.mileageText, icon: Gauge },
        { label: 'Fuel', value: vehicle.fuel, icon: Fuel },
        { label: 'Gearbox', value: vehicle.transmission, icon: Settings2 },
      ].filter((highlight): highlight is { label: string; value: string; icon: typeof CarIcon } => Boolean(highlight.value))
    : [];

  return (
    <div className="min-h-[calc(100dvh-4.5rem)] bg-background">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10 lg:px-8">
        <Link href="/" className="appointment-rise inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-primary" data-testid="link-back-to-showroom">
          <ArrowLeft className="h-4 w-4" /> Back to showroom
        </Link>

        <div className="mt-8 grid gap-8 lg:mt-12 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)] lg:items-start lg:gap-12">
          <aside className="appointment-rise appointment-rise-delay-1 relative overflow-hidden rounded-[1.5rem] bg-primary px-6 py-7 text-primary-foreground shadow-[0_18px_48px_hsl(var(--primary)/.18)] sm:px-9 sm:py-10 lg:sticky lg:top-28">
            <div className="pointer-events-none absolute -right-20 -top-24 hidden h-64 w-64 rounded-full border border-accent/20 sm:block" />
            <div className="pointer-events-none absolute -right-9 -top-12 hidden h-44 w-44 rounded-full border border-accent/15 sm:block" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.08] text-accent">
                  <CarIcon className="h-5 w-5" />
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary-foreground/55"><span className="h-1.5 w-1.5 rounded-full bg-[#78bd8c]" /> Luxxy concierge</span>
              </div>
              <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-accent">{copy.eyebrow}</p>
               <h1 className="font-display mt-3 text-[2.35rem] leading-[.98] tracking-tight sm:text-6xl lg:text-[3.8rem]">{copy.title}</h1>
              <p className="mt-5 max-w-sm text-sm leading-6 text-primary-foreground/70">{copy.description}</p>

              {vehicle && (
                <div className="appointment-rise appointment-rise-delay-2 mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07]" data-testid="card-selected-vehicle">
                <div className="relative h-32 overflow-hidden bg-black/20 sm:h-52">
                    {vehicleImage ? (
                      <img src={vehicleImage} alt={selectedVehicleName} referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" data-testid={`img-selected-vehicle-${vehicle.id}`} />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center text-primary-foreground/55" data-testid="empty-selected-vehicle-image">
                        <Camera className="h-8 w-8" />
                        <span className="mt-2 text-xs font-semibold">Image unavailable</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">You are enquiring about</p>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-bold leading-tight text-white" data-testid={`text-selected-vehicle-${vehicle.id}`}>{selectedVehicleName}</h2>
                        {(vehicle.variant || vehicle.trim) && <p className="mt-1 truncate text-xs text-primary-foreground/60">{vehicle.variant || vehicle.trim}</p>}
                      </div>
                      {vehicle.price != null && <p className="shrink-0 text-lg font-black text-accent" data-testid={`text-selected-vehicle-price-${vehicle.id}`}>{formatPrice(vehicle.price, vehicle.currency)}</p>}
                    </div>
                    {vehicleHighlights.length > 0 && (
                      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-white/10 pt-4">
                        {vehicleHighlights.map(({ label, value, icon: Icon }) => (
                          <div key={label} className="flex min-w-0 items-center gap-2">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
                            <div className="min-w-0">
                              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/45">{label}</p>
                              <p className="truncate text-xs font-bold text-white">{value}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-9 border-t border-white/10 pt-6">
                <div className="flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-sm font-bold text-white">A considered visit</p>
                    <p className="mt-1 text-xs leading-5 text-primary-foreground/60">No hard sell. Take your time, ask anything, and drive away feeling certain.</p>
                  </div>
                </div>
                <div className="mt-5 flex items-start gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-sm font-bold text-white">At the Luxxy showroom</p>
                    <p className="mt-1 text-xs leading-5 text-primary-foreground/60">Your confirmation will include everything you need for the journey.</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <section className="appointment-rise appointment-rise-delay-2 min-w-0">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] text-accent-foreground">1</span>
                {type === 'viewing' ? 'Reserve your visit' : 'Start your enquiry'}
              </div>
              {type === 'viewing' && <span className="hidden items-center gap-1.5 text-xs font-semibold text-muted-foreground sm:flex"><Clock3 className="h-4 w-4" /> Takes about 2 minutes</span>}
            </div>
            <div className="rounded-[1.5rem] border border-[#e5ded1] bg-card p-5 shadow-[0_12px_30px_rgba(49,42,29,.05)] sm:p-8 lg:p-10">
              {isLoading ? (
                <div className="space-y-5 py-10" data-testid="loading-enquiry-vehicle">
                  <div className="h-5 w-44 animate-pulse rounded bg-muted" />
                  <div className="h-10 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="grid gap-4 sm:grid-cols-2"><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></div>
                  <div className="h-28 animate-pulse rounded bg-muted" />
                </div>
              ) : error ? (
                <div className="flex items-start gap-3 rounded-xl border border-[#e8c6c0] bg-[#fff2ef] p-5 text-sm text-[#8d3e34]" role="alert" data-testid="status-stock-error">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <div><p className="font-bold">We could not load the showroom details.</p><p className="mt-1">You can still send an enquiry and our team will help match it to the right vehicle.</p></div>
                </div>
              ) : vehicleId && !vehicle ? (
                <div className="mb-7 flex items-start gap-3 rounded-xl border border-[#e2cf9d] bg-[#fff8e6] p-4 text-sm text-[#80611f]" role="alert" data-testid="status-vehicle-unavailable">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <p><strong>This vehicle has just left the showroom.</strong> You can still send a general enquiry below and we will help find a close alternative.</p>
                </div>
              ) : null}
              <EnquiryForm initialType={type} vehicle={vehicle} />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { icon: ShieldCheck, title: 'No pressure', text: 'A viewing is simply time with the car.' },
                { icon: Mail, title: 'Clear confirmation', text: 'Your details arrive straight in our inbox.' },
                { icon: Phone, title: 'Real people', text: 'Questions? We are happy to talk.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex items-start gap-3 rounded-xl border border-[#e5ded1] bg-[#faf7f0] p-4" data-testid={`info-enquiry-${title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div><p className="text-xs font-bold text-foreground">{title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{text}</p></div>
                </div>
              ))}
            </div>
            {type === 'viewing' && !vehicle && (
              <Link href="/#stock" className="group mt-7 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/75" data-testid="link-browse-stock-from-enquiry">
                Not sure which car yet? Browse current stock <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}