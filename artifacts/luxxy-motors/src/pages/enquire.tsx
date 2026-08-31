import { useMemo } from 'react';
import { ArrowLeft, CalendarDays, Camera, Car as CarIcon, CircleAlert, Fuel, LoaderCircle, Settings2 } from 'lucide-react';
import { Link } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { useStock } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl } from '@/lib/utils';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'delivery', 'warranty', 'part_exchange'];
const headings: Record<EnquiryType, { eyebrow: string; title: string; description: string }> = {
  viewing: { eyebrow: 'Plan your visit', title: 'Choose a time that works for you', description: 'Pick an available date and time below and we’ll have everything ready for your Luxxy Motors viewing.' },
  general: { eyebrow: 'We are here to help', title: 'Send an enquiry', description: 'Share your question and the Luxxy Motors team will get back to you shortly.' },
  delivery: { eyebrow: 'Nationwide delivery', title: 'Ask about delivery', description: 'Tell us where you are and we will help plan the next steps for getting your vehicle to you.' },
  warranty: { eyebrow: 'Added peace of mind', title: 'Ask about warranty', description: 'Send your details and we will explain the warranty options available for your vehicle.' },
  part_exchange: { eyebrow: 'Part exchange', title: 'Request a valuation', description: 'Tell us about your current car and we will help you understand your part-exchange options.' },
};

export default function Enquire() {
  const { stock, isLoading } = useStock();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedType = params.get('type') as EnquiryType | null;
  const type = requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general';
  const vehicleId = params.get('vehicleId');
  const vehicle = stock?.cars.find((car) => car.id === vehicleId);
  const copy = headings[type];
  const vehicleLabel = vehicle?.title || [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Selected vehicle';
  const vehicleImage = vehicle ? getThumbnailUrl(vehicle) : '';
  const vehicleHighlights = vehicle
    ? [
        { label: 'Year', value: vehicle.year ? String(vehicle.year) : null, icon: CalendarDays },
        { label: 'Mileage', value: vehicle.mileage ? formatMileage(vehicle.mileage) : vehicle.mileageText, icon: CarIcon },
        { label: 'Fuel', value: vehicle.fuel, icon: Fuel },
        { label: 'Gearbox', value: vehicle.transmission, icon: Settings2 },
      ].filter((highlight): highlight is { label: string; value: string; icon: typeof CarIcon } => Boolean(highlight.value))
    : [];

  return (
    <div className="min-h-[70vh] bg-muted/20 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-8 inline-flex items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to showroom
        </Link>
        <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
          <aside className="rounded-2xl bg-primary p-7 text-primary-foreground shadow-lg sm:p-9">
            <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-accent">
              <CarIcon className="h-7 w-7" />
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-accent">{copy.eyebrow}</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">{copy.title}</h1>
            <p className="mt-5 leading-relaxed text-primary-foreground/75">{copy.description}</p>
            {vehicle && (
              <div className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.07]">
                <div className="relative aspect-[16/10] overflow-hidden bg-black/20">
                  {vehicleImage ? (
                    <img
                      src={vehicleImage}
                      alt={vehicleLabel}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-primary-foreground/60">
                      <Camera className="h-8 w-8" />
                      <span className="mt-2 text-xs font-semibold">Image unavailable</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Your selected vehicle</p>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-bold leading-tight text-white">{vehicleLabel}</h2>
                      {(vehicle.variant || vehicle.trim) && (
                        <p className="mt-1 truncate text-xs text-primary-foreground/65">{vehicle.variant || vehicle.trim}</p>
                      )}
                    </div>
                    {vehicle.price != null && (
                      <p className="shrink-0 text-lg font-black text-accent">{formatPrice(vehicle.price, vehicle.currency)}</p>
                    )}
                  </div>
                  {vehicleHighlights.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                      {vehicleHighlights.map(({ label, value, icon: Icon }) => (
                        <div key={label} className="flex min-w-0 items-center gap-2">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/50">{label}</p>
                            <p className="truncate text-xs font-bold text-white">{value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="mt-8 border-t border-white/15 pt-6 text-sm text-primary-foreground/70">
              <p className="font-bold text-white">Luxxy Motors</p>
              <p className="mt-1">We’ll confirm your appointment during opening hours.</p>
            </div>
          </aside>
          <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-9">
            {isLoading ? (
              <div className="flex items-center gap-3 py-12 text-muted-foreground">
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" /> Loading vehicle details…
              </div>
            ) : vehicleId && !vehicle ? (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <p>This vehicle is no longer visible in the showroom. You can still send a general enquiry below.</p>
              </div>
            ) : null}
            <EnquiryForm initialType={type} vehicle={vehicle} />
          </section>
        </div>
      </div>
    </div>
  );
}