import { useMemo } from 'react';
import { ArrowLeft, Car as CarIcon, CircleAlert, LoaderCircle } from 'lucide-react';
import { Link } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { useStock } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';

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