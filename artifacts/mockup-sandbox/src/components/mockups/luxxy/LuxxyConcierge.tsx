import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Fuel,
  Heart,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

type Vehicle = {
  id: string;
  name: string;
  detail: string;
  price: string;
  monthly: string;
  mileage: string;
  fuel: string;
  gearbox: string;
  year: string;
  color: string;
  accent: string;
  fit: number;
  tag: string;
};

const vehicles: Vehicle[] = [
  {
    id: "bmw-320d",
    name: "BMW 3 Series",
    detail: "320d M Sport · Saloon",
    price: "£18,495",
    monthly: "£348 / month",
    mileage: "42,180 miles",
    fuel: "Diesel",
    gearbox: "Automatic",
    year: "2021",
    color: "Pearl silver",
    accent: "from-[#d7ddd8] via-[#8a9795] to-[#27333a]",
    fit: 96,
    tag: "Best match",
  },
  {
    id: "audi-a3",
    name: "Audi A3",
    detail: "35 TFSI S line · Sportback",
    price: "£16,990",
    monthly: "£319 / month",
    mileage: "31,640 miles",
    fuel: "Petrol",
    gearbox: "Automatic",
    year: "2020",
    color: "Glacier white",
    accent: "from-[#e7e4dc] via-[#a6a5a0] to-[#46505a]",
    fit: 91,
    tag: "Lower mileage",
  },
  {
    id: "volvo-xc40",
    name: "Volvo XC40",
    detail: "T3 R-Design · SUV",
    price: "£20,750",
    monthly: "£390 / month",
    mileage: "28,905 miles",
    fuel: "Petrol",
    gearbox: "Automatic",
    year: "2021",
    color: "Moss green",
    accent: "from-[#bfcfc1] via-[#687b71] to-[#263b3b]",
    fit: 88,
    tag: "Family pick",
  },
  {
    id: "mini-clubman",
    name: "MINI Clubman",
    detail: "Cooper S · Exclusive",
    price: "£15,450",
    monthly: "£291 / month",
    mileage: "36,120 miles",
    fuel: "Petrol",
    gearbox: "Manual",
    year: "2019",
    color: "Deep navy",
    accent: "from-[#b7beca] via-[#536077] to-[#202638]",
    fit: 82,
    tag: "Characterful",
  },
];

const filterOptions = ["Automatic", "Under £20k", "Low mileage", "HPI clear"];

export default function LuxxyConcierge() {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("Automatic");
  const [sort, setSort] = useState("best");
  const [shortlist, setShortlist] = useState<string[]>(["bmw-320d"]);
  const [activeVehicle, setActiveVehicle] = useState<Vehicle>(vehicles[0]);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [sent, setSent] = useState(false);

  const visibleVehicles = useMemo(() => {
    const needle = query.toLowerCase().trim();
    const filtered = vehicles.filter((vehicle) => {
      const matchesQuery =
        !needle ||
        `${vehicle.name} ${vehicle.detail} ${vehicle.fuel} ${vehicle.gearbox}`
          .toLowerCase()
          .includes(needle);
      if (!matchesQuery) return false;
      if (activeFilter === "Automatic" && vehicle.gearbox !== "Automatic") return false;
      if (activeFilter === "Under £20k" && Number(vehicle.price.replace(/[£,]/g, "")) >= 20000) return false;
      if (activeFilter === "Low mileage" && Number(vehicle.mileage.replace(/[ miles,]/g, "")) > 35000) return false;
      return true;
    });
    return [...filtered].sort((a, b) => (sort === "price" ? Number(a.price.replace(/[£,]/g, "")) - Number(b.price.replace(/[£,]/g, "")) : b.fit - a.fit));
  }, [activeFilter, query, sort]);

  const toggleShortlist = (id: string) => {
    setShortlist((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <div className="min-h-[100dvh] bg-[#f3f4ee] text-[#17252a] [font-family:ui-sans-serif,system-ui,sans-serif]">
      <header className="sticky top-0 z-30 border-b border-[#d9ddd5] bg-[#f3f4ee]/95 backdrop-blur-md">
        <div className="mx-auto flex h-[74px] max-w-[1450px] items-center justify-between gap-5 px-5 lg:px-8">
          <button type="button" onClick={() => { setQuery(""); setActiveFilter("Automatic"); }} className="group flex items-center gap-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#17353a] text-[#e8b54a] shadow-sm transition-transform group-hover:-rotate-3">
              <Compass className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[15px] font-extrabold tracking-[0.16em] text-[#17353a]">LUXXY</span>
              <span className="block text-[9px] font-bold tracking-[0.26em] text-[#7b8987]">MOTORS / HARROW</span>
            </span>
          </button>
          <div className="hidden items-center gap-8 text-[13px] font-bold text-[#526160] md:flex">
            <button type="button" onClick={() => document.getElementById("browse")?.scrollIntoView({ behavior: "smooth" })} className="text-[#17353a]">Browse stock</button>
            <button type="button" onClick={() => setAppointmentOpen(true)} className="transition-colors hover:text-[#17353a]">Your visit</button>
            <button type="button" onClick={() => setShortlist([])} className="transition-colors hover:text-[#17353a]">Saved <span className="ml-1 rounded-full bg-[#e4e9e2] px-2 py-0.5 text-[11px] text-[#17353a]">{shortlist.length}</span></button>
          </div>
          <div className="flex items-center gap-2">
            <a href="tel:02084729917" className="hidden items-center gap-2 rounded-full px-3 py-2 text-[12px] font-bold text-[#526160] transition-colors hover:bg-white md:flex">
              <MessageCircle className="h-4 w-4 text-[#b68729]" /> 020 8472 9917
            </a>
            <button type="button" onClick={() => setAppointmentOpen(true)} className="hidden rounded-full bg-[#e6b34b] px-4 py-2.5 text-[12px] font-extrabold text-[#17353a] shadow-sm transition-transform hover:-translate-y-0.5 sm:block">Book a viewing</button>
            <button type="button" onClick={() => setMobileFilters((open) => !open)} className="rounded-full border border-[#cfd7d0] p-2 md:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1450px] gap-8 px-5 pb-10 pt-10 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-center lg:px-8 lg:pb-14 lg:pt-16">
          <div className="max-w-[720px]">
            <div className="mb-5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#b68729]"><Sparkles className="h-4 w-4" /> The considered way to buy used</div>
            <h1 className="max-w-[690px] text-[clamp(3rem,7vw,6.5rem)] font-black leading-[0.89] tracking-[-0.075em] text-[#17353a]">Start with<br /><em className="font-serif font-normal tracking-[-0.06em] text-[#b68729]">what matters.</em></h1>
            <p className="mt-7 max-w-[525px] text-[17px] leading-7 text-[#60706d]">Tell us what your next car needs to do. We’ll narrow the showroom to a few good fits — no scrolling through hundreds of listings.</p>
            <div className="mt-8 flex flex-wrap gap-2 text-[12px] font-bold text-[#5a6b68]">
              <span className="rounded-full bg-[#e6ebe4] px-3 py-2">✓ 42 cars in stock</span>
              <span className="rounded-full bg-[#e6ebe4] px-3 py-2">✓ Harrow, London</span>
              <span className="rounded-full bg-[#e6ebe4] px-3 py-2">✓ View by appointment</span>
            </div>
          </div>
          <div className="relative min-h-[270px] overflow-hidden rounded-[28px] bg-[#17353a] shadow-[0_22px_55px_rgba(30,54,54,0.16)] lg:min-h-[355px]">
            <img src="/__mockup/images/luxxy-concierge-hero.png" alt="Silver BMW on a London forecourt" className="absolute inset-0 h-full w-full object-cover opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#17353a]/90 via-[#17353a]/15 to-transparent" />
            <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between text-white">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#e6b34b]">Featured today</p><p className="mt-1 text-2xl font-extrabold tracking-tight">BMW 3 Series</p><p className="text-sm text-white/70">320d M Sport · £18,495</p></div>
              <button type="button" onClick={() => { setActiveVehicle(vehicles[0]); document.getElementById("browse")?.scrollIntoView({ behavior: "smooth" }); }} className="grid h-11 w-11 place-items-center rounded-full bg-[#e6b34b] text-[#17353a] transition-transform hover:scale-105" aria-label="See featured car"><ArrowRight className="h-5 w-5" /></button>
            </div>
          </div>
        </section>

        <section id="browse" className="border-y border-[#d9ddd5] bg-[#e9ede6]">
          <div className="mx-auto grid max-w-[1450px] gap-8 px-5 py-7 lg:grid-cols-[225px_minmax(0,1fr)] lg:px-8 lg:py-10">
            <aside className={`${mobileFilters ? "block" : "hidden"} lg:block`}>
              <div className="flex items-center justify-between"><p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#70807b]">Shape your search</p><button type="button" onClick={() => setActiveFilter("")} className="text-[11px] font-bold text-[#b68729]">Reset</button></div>
              <div className="mt-5 space-y-6">
                <div><p className="mb-2 text-[12px] font-extrabold text-[#17353a]">I’m looking for</p><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#84918d]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Make or model" className="h-11 w-full rounded-xl border border-[#cfd7d0] bg-[#f6f7f2] pl-9 pr-3 text-sm font-semibold outline-none transition-shadow focus:ring-2 focus:ring-[#e6b34b]" /></div></div>
                <div><p className="mb-2 text-[12px] font-extrabold text-[#17353a]">Priorities</p><div className="space-y-2">{filterOptions.map((option) => <button type="button" key={option} onClick={() => setActiveFilter(activeFilter === option ? "" : option)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[12px] font-bold transition-colors ${activeFilter === option ? "bg-[#17353a] text-white" : "text-[#60706d] hover:bg-[#f6f7f2]"}`}>{option}{activeFilter === option ? <Check className="h-4 w-4 text-[#e6b34b]" /> : <Plus className="h-4 w-4 text-[#9aa7a2]" />}</button>)}</div></div>
                <div className="rounded-2xl bg-[#f6f7f2] p-4"><div className="flex gap-2"><CircleHelp className="h-4 w-4 shrink-0 text-[#b68729]" /><p className="text-[11px] leading-5 text-[#63726e]"><strong className="text-[#17353a]">Not sure yet?</strong><br />Start with a quick chat and we’ll do the shortlisting.</p></div><button type="button" onClick={() => setAppointmentOpen(true)} className="mt-3 text-[11px] font-extrabold text-[#b68729]">Talk to a specialist <ArrowRight className="ml-1 inline h-3 w-3" /></button></div>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div><div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#b68729]"><SlidersHorizontal className="h-3.5 w-3.5" /> Your shortlist</div><h2 className="mt-2 text-[clamp(1.7rem,3vw,2.5rem)] font-black tracking-[-0.05em] text-[#17353a]">{visibleVehicles.length} considered options <span className="font-serif font-normal text-[#8a9993]">for you.</span></h2></div>
                <div className="flex items-center gap-2"><span className="text-[11px] font-bold text-[#81908b]">Sort by</span><button type="button" onClick={() => setSort(sort === "best" ? "price" : "best")} className="flex items-center gap-2 rounded-full border border-[#cfd7d0] bg-[#f6f7f2] px-3 py-2 text-[11px] font-extrabold text-[#17353a]">{sort === "best" ? "Best match" : "Price: low to high"}<ArrowDownUp className="h-3.5 w-3.5" /></button></div>
              </div>
              <div className="space-y-4">
                {visibleVehicles.map((vehicle) => {
                  const isSaved = shortlist.includes(vehicle.id);
                  return <article key={vehicle.id} className={`group grid overflow-hidden rounded-[22px] border bg-[#f7f8f3] transition-all md:grid-cols-[245px_minmax(0,1fr)] ${activeVehicle.id === vehicle.id ? "border-[#b8c5bd] shadow-[0_10px_28px_rgba(29,52,51,0.08)]" : "border-[#d9ddd5]"}`}>
                    <button type="button" onClick={() => setActiveVehicle(vehicle)} className={`relative min-h-[178px] overflow-hidden bg-gradient-to-br ${vehicle.accent} text-left md:min-h-[190px]`}>
                      <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse at 40% 42%, rgba(255,255,255,.7), transparent 36%), linear-gradient(145deg, transparent 44%, rgba(12,28,32,.45) 45%, transparent 49%)" }} />
                      <div className="absolute bottom-3 left-3 rounded-full bg-[#f5f6ef]/85 px-2.5 py-1 text-[10px] font-extrabold text-[#17353a] backdrop-blur">{vehicle.tag}</div>
                      <div className="absolute right-3 top-3 rounded-full bg-[#17353a]/75 px-2 py-1 text-[10px] font-black text-[#e6b34b] backdrop-blur">{vehicle.fit}% fit</div>
                    </button>
                    <div className="flex flex-col justify-between p-5">
                      <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-[#899691]">{vehicle.year} · {vehicle.color}</p><button type="button" onClick={() => setActiveVehicle(vehicle)} className="mt-1 text-left text-[21px] font-black tracking-[-0.04em] text-[#17353a] hover:text-[#b68729]">{vehicle.name}</button><p className="mt-0.5 text-[13px] font-semibold text-[#71807b]">{vehicle.detail}</p></div><button type="button" onClick={() => toggleShortlist(vehicle.id)} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors ${isSaved ? "border-[#e6b34b] bg-[#fff1cc] text-[#a87616]" : "border-[#d5ddd6] text-[#95a29c] hover:text-[#17353a]"}`} aria-label={isSaved ? `Remove ${vehicle.name} from saved` : `Save ${vehicle.name}`}><Heart className={`h-4 w-4 ${isSaved ? "fill-current" : ""}`} /></button></div>
                      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-bold text-[#64736e]"><span><CalendarDays className="mr-1 inline h-3.5 w-3.5 text-[#b68729]" />{vehicle.year}</span><span><GaugeIcon />{vehicle.mileage}</span><span><Fuel className="mr-1 inline h-3.5 w-3.5 text-[#b68729]" />{vehicle.fuel}</span><span><Settings2 className="mr-1 inline h-3.5 w-3.5 text-[#b68729]" />{vehicle.gearbox}</span></div>
                      <div className="mt-5 flex items-end justify-between gap-3 border-t border-[#e1e5df] pt-4"><div><p className="text-[23px] font-black tracking-[-0.04em] text-[#17353a]">{vehicle.price}</p><p className="text-[10px] font-bold text-[#899691]">{vehicle.monthly}</p></div><button type="button" onClick={() => setAppointmentOpen(true)} className="rounded-full bg-[#17353a] px-4 py-2.5 text-[11px] font-extrabold text-white transition-colors hover:bg-[#28555a]">View & book <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></div>
                    </div>
                  </article>;
                })}
                {visibleVehicles.length === 0 && <div className="rounded-2xl border border-dashed border-[#bdc9c1] bg-[#f6f7f2] p-14 text-center"><Search className="mx-auto h-7 w-7 text-[#b68729]" /><p className="mt-4 font-black text-[#17353a]">Nothing quite fits that brief</p><button type="button" onClick={() => { setQuery(""); setActiveFilter(""); }} className="mt-2 text-xs font-bold text-[#b68729]">Clear the search</button></div>}
              </div>
              {shortlist.length > 0 && <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-2xl border border-[#ded8c4] bg-[#fff9e9] px-4 py-3 sm:flex-row sm:items-center"><div className="flex items-center gap-2 text-[12px] font-bold text-[#66562e]"><Heart className="h-4 w-4 fill-[#b68729] text-[#b68729]" /> {shortlist.length} saved for your next visit</div><button type="button" onClick={() => setAppointmentOpen(true)} className="text-[12px] font-extrabold text-[#9a6d12]">Bring these to a viewing <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></div>}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1450px] gap-7 px-5 py-12 sm:grid-cols-3 lg:px-8 lg:py-16">
          <div className="border-l-2 border-[#e6b34b] pl-4"><ShieldCheck className="h-5 w-5 text-[#b68729]" /><h3 className="mt-4 text-lg font-black text-[#17353a]">The clear version</h3><p className="mt-2 text-sm leading-6 text-[#71807b]">Straightforward pricing, honest vehicle notes and no pressure when you visit.</p></div>
          <div className="border-l-2 border-[#e6b34b] pl-4"><MapPin className="h-5 w-5 text-[#b68729]" /><h3 className="mt-4 text-lg font-black text-[#17353a]">A real appointment</h3><p className="mt-2 text-sm leading-6 text-[#71807b]">Come to our Harrow showroom, or ask about delivery anywhere in the UK.</p></div>
          <div className="border-l-2 border-[#e6b34b] pl-4"><Clock3 className="h-5 w-5 text-[#b68729]" /><h3 className="mt-4 text-lg font-black text-[#17353a]">Your pace, always</h3><p className="mt-2 text-sm leading-6 text-[#71807b]">Save a few options and pick up the conversation when you’re ready.</p></div>
        </section>
      </main>

      {appointmentOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17353a]/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Book a viewing"><div className="w-full max-w-[480px] rounded-t-[28px] bg-[#f7f8f3] p-6 shadow-2xl sm:rounded-[28px] sm:p-8"><div className="flex items-start justify-between"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#b68729]">A good next step</p><h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-[#17353a]">Come and see it.</h2><p className="mt-2 text-sm leading-6 text-[#71807b]">We’ll have {activeVehicle.name} ready, plus the other cars you saved.</p></div><button type="button" onClick={() => { setAppointmentOpen(false); setSent(false); }} className="rounded-full p-2 text-[#75827e] hover:bg-[#e9ede6]" aria-label="Close booking dialog"><X className="h-5 w-5" /></button></div>{sent ? <div className="my-8 rounded-2xl bg-[#e5efe5] p-5 text-center"><Check className="mx-auto h-7 w-7 text-[#3e7559]" /><p className="mt-3 font-black text-[#17353a]">We’ll be in touch shortly.</p><p className="mt-1 text-xs text-[#60706d]">Your shortlist is saved for the conversation.</p></div> : <div className="mt-7 space-y-3"><label className="block text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#60706d]">Your name<input className="mt-2 h-11 w-full rounded-xl border border-[#cfd7d0] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#e6b34b]" placeholder="How should we address you?" /></label><label className="block text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#60706d]">Best day to visit<select className="mt-2 h-11 w-full rounded-xl border border-[#cfd7d0] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#e6b34b]"><option>Choose a day</option><option>Saturday morning</option><option>Saturday afternoon</option><option>Next week</option></select></label><button type="button" onClick={() => setSent(true)} className="mt-3 h-12 w-full rounded-full bg-[#e6b34b] text-sm font-extrabold text-[#17353a] transition-transform hover:-translate-y-0.5">Request a viewing <ArrowRight className="ml-1 inline h-4 w-4" /></button><p className="text-center text-[10px] font-semibold text-[#8a9792]">Or call 020 8472 9917</p></div>}</div></div>}
    </div>
  );
}

function GaugeIcon() {
  return <span className="mr-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#b68729] align-[-2px]"><Minus className="h-2.5 w-2.5 text-[#b68729]" /></span>;
}