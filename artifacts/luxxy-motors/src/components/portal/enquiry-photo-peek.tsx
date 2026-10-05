import { useState } from "react";
import { createPortal } from "react-dom";
import type { Car } from "@/lib/stock-context";
import { vehicleDisplayTitle, vehicleRegistration, vehicleRegistrationLabel } from "@/lib/utils";

export function EnquiryPhotoPeek({ car, className }: { car: Car; className: string }) {
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  if (!car.heroImage || failed) return null;

  const plate = vehicleRegistration(car);
  const registrationBand = !plate ? vehicleRegistrationLabel(car) : "";
  const show = (element: HTMLElement) => {
    // Keep the full photograph on-screen even for cars at the edge of the grid.
    const rect = element.getBoundingClientRect();
    const width = Math.min(560, window.innerWidth - 24);
    setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 12, window.innerHeight * 0.42 - 68)) });
  };

  return <>
    <span className="block shrink-0 cursor-zoom-in" onMouseEnter={event => show(event.currentTarget)} onMouseLeave={() => setPosition(null)}>
      <img src={car.heroImage} alt={`Preview ${vehicleDisplayTitle(car)}`} loading="lazy" className={className} onError={() => { setFailed(true); setPosition(null); }} />
    </span>
    {position && createPortal(<div role="status" aria-label={`Enlarged photo of ${vehicleDisplayTitle(car)}`} className="pointer-events-none fixed z-[100] overflow-hidden rounded-md border border-slate-400 bg-slate-950 p-2 text-white shadow-2xl" style={{ top: position.top, left: position.left, width: position.width }}>
      <img src={car.heroImage} alt="" className="max-h-[56vh] w-full bg-slate-900 object-contain" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 text-sm"><strong className="font-semibold">{vehicleDisplayTitle(car)}</strong>{car.colour && <span>Colour: {car.colour}</span>}{plate ? <span className="rounded-sm bg-yellow-300 px-2 py-0.5 font-bold tracking-wider text-slate-950">{plate}</span> : <span className="text-slate-300">{registrationBand ? `${registrationBand} · ` : ""}Number plate not supplied</span>}</div>
    </div>, document.body)}
  </>;
}
