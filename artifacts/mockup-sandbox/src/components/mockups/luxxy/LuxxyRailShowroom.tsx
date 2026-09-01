import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  Banknote,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Fuel,
  Gauge,
  Grid2X2,
  Heart,
  MapPin,
  Menu,
  Phone,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

type CarItem = {
  id: number;
  name: string;
  trim: string;
  price: string;
  year: string;
  mileage: string;
  fuel: string;
  transmission: string;
  colour: string;
  tone: string;
  image?: string;
  tag?: string;
};

const stock: CarItem[] = [
  {
    id: 1,
    name: "BMW 3 Series",
    trim: "320d M Sport",
    price: "£14,995",
    year: "2019",
    mileage: "42,180 miles",
    fuel: "Diesel",
    transmission: "Automatic",
    colour: "Mineral Grey",
    tone: "from-[#25333a] via-[#5b6865] to-[#b4b7ac]",
    image: "/__mockup/images/luxxy-rail-showroom-hero.png",
    tag: "Just in",
  },
  {
    id: 2,
    name: "Honda Civic",
    trim: "1.5 VTEC Turbo Sport",
    price: "£13,490",
    year: "2018",
    mileage: "38,602 miles",
    fuel: "Petrol",
    transmission: "Manual",
    colour: "Polished Metal",
    tone: "from-[#c6c7bf] via-[#717977] to-[#252f33]",
  },
  {
    id: 3,
    name: "MG ZS",
    trim: "Excite T-GDI",
    price: "£11,250",
    year: "2020",
    mileage: "29,410 miles",
    fuel: "Petrol",
    transmission: "Automatic",
    colour: "Arctic White",
    tone: "from-[#e4e1d8] via-[#aeb8b0] to-[#53645f]",
    tag: "Low mileage",
  },
  {
    id: 4,
    name: "Toyota Yaris",
    trim: "1.5 VVT-i Icon",
    price: "£9,995",
    year: "2017",
    mileage: "31,774 miles",
    fuel: "Hybrid",
    transmission: "Automatic",
    colour: "Deep Ocean",
    tone: "from-[#1d3440] via-[#28616c] to-[#9aa89c]",
  },
];

const makes = ["All makes", "BMW", "Honda", "MG", "Toyota"];

function MiniCarArt({ car }: { car: CarItem }) {
  return (
    <div className={`relative h-full min-h-[180px] overflow-hidden bg-gradient-to-br ${car.tone}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.24),transparent_32%),linear-gradient(120deg,transparent_40%,rgba(14,29,32,.45))]" />
      <div className="absolute -bottom-2 left-[12%] right-[8%] h-[37%] rounded-[55%_48%_20%_18%] border-[5px] border-black/25 bg-black/35 shadow-[0_18px_25px_rgba(10,25,28,.28)]">
        <div className="absolute left-[16%] top-[-27%] h-[75%] w-[57%] skew-x-[-14deg] rounded-[48%_42%_10%_15%] border-2 border-white/25 bg-gradient-to-b from-white/35 to-black/30">
          <div className="absolute inset-x-[10%] top-[13%] h-[42%] rounded-[50%_28%_12%_12%] bg-slate-800/65" />
        </div>
        <div className="absolute bottom-[-13%] left-[13%] h-8 w-8 rounded-full border-[5px] border-slate-900 bg-slate-500 shadow-[42px_0_0_-5px_#647079,42px_0_0_0_#162126]" />
      </div>
      <span className="absolute bottom-3 left-4 rounded-full bg-black/25 px-2 py-1 text-[9px] font-black uppercase tracking-[.18em] text-white/75">
        {car.colour}
      </span>
    </div>
  );
}

function FieldLabel({ icon: Icon, children }: { icon: typeof CarFront; children: React.ReactNode }) {
  return (
    <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.16em] text-[#718078]">
      <Icon className="h-3.5 w-3.5 text-[#b4872b]" />
      {children}
    </span>
  );
}

export function LuxxyRailShowroom() {
  const [query, setQuery] = useState("");
  const [make, setMake] = useState("All makes");
  const [budget, setBudget] = useState("");
  const [transmission, setTransmission] = useState("");
  const [sort, setSort] = useState("Recommended");
  const [saved, setSaved] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [selectedCar, setSelectedCar] = useState<CarItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("Stock");
  const [hpiClear, setHpiClear] = useState(true);

  const filteredStock = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = stock.filter((car) => {
      const matchesQuery = !normalized || `${car.name} ${car.trim} ${car.colour}`.toLowerCase().includes(normalized);
      const matchesMake = make === "All makes" || car.name.startsWith(make);
      const matchesBudget = !budget || (budget === "under-10" ? Number(car.price.replace(/[£,]/g, "")) < 10000 : Number(car.price.replace(/[£,]/g, "")) < 15000);
      const matchesTransmission = !transmission || car.transmission === transmission;
      return matchesQuery && matchesMake && matchesBudget && matchesTransmission;
    });
    if (sort === "Price: low to high") return [...filtered].sort((a, b) => Number(a.price.replace(/[£,]/g, "")) - Number(b.price.replace(/[£,]/g, "")));
    if (sort === "Mileage: low to high") return [...filtered].sort((a, b) => Number(a.mileage.replace(/[^0-9]/g, "")) - Number(b.mileage.replace(/[^0-9]/g, "")));
    return filtered;
  }, [budget, make, query, sort, transmission]);

  const activeFilters = [make !== "All makes", Boolean(budget), Boolean(transmission), Boolean(query), !hpiClear].filter(Boolean).length;

  const resetSearch = () => {
    setQuery("");
    setMake("All makes");
    setBudget("");
    setTransmission("");
    setSort("Recommended");
    setHpiClear(true);
  };

  const jumpTo = (section: string) => {
    setActiveSection(section);
    setMenuOpen(false);
    document.getElementById(section === "Stock" ? "results" : "services")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-[100dvh] bg-[#edf0e9] text-[#182a2d]" style={{ fontFamily: '"Avenir Next", "Trebuchet MS", ui-sans-serif, sans-serif' }}>
      <header className="sticky top-0 z-30 border-b border-[#dce2d9] bg-[#f8f7f0]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <button type="button" onClick={() => jumpTo("Stock")} className="group flex items-center gap-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#19383b] text-[#f0bb51] shadow-[0_5px_14px_rgba(25,56,59,.18)] transition group-hover:-rotate-3">
              <CarFront className="h-5 w-5" />
            </span>
            <span className="leading-none">
              <span className="block text-[15px] font-black tracking-[.16em] text-[#19383b]">LUXXY</span>
              <span className="mt-1 block text-[9px] font-bold tracking-[.36em] text-[#a97925]">MOTORS</span>
            </span>
          </button>

          <nav className="hidden items-center gap-7 text-[12px] font-black text-[#60706a] lg:flex">
            {["Stock", "Part exchange", "Warranty", "Delivery"].map((item) => (
              <button key={item} type="button" onClick={() => jumpTo(item === "Stock" ? "Stock" : "Services")} className={`relative py-2 transition hover:text-[#19383b] ${activeSection === item ? "text-[#19383b]" : ""}`}>
                {item}
                {activeSection === item && <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[#d8a13a]" />}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-4 md:flex">
            <div className="flex items-center gap-2 text-right">
              <MapPin className="h-4 w-4 text-[#b4872b]" />
              <span><span className="block text-[10px] font-black uppercase tracking-[.14em] text-[#76837d]">Showroom</span><span className="block text-xs font-bold text-[#19383b]">Harrow, London</span></span>
            </div>
            <a href="tel:02084729917" className="grid h-10 w-10 place-items-center rounded-full border border-[#d6dfd6] bg-[#fffdf7] text-[#19383b] transition hover:border-[#b4872b] hover:bg-[#19383b] hover:text-[#f0bb51]" aria-label="Call Luxxy Motors">
              <Phone className="h-4 w-4" />
            </a>
          </div>
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded-lg p-2 text-[#19383b] md:hidden" aria-label="Toggle navigation">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-[#dce2d9] bg-[#f8f7f0] px-5 py-4 md:hidden">
            <div className="grid gap-1">
              {["Stock", "Part exchange", "Warranty", "Delivery"].map((item) => <button key={item} type="button" onClick={() => jumpTo(item === "Stock" ? "Stock" : "Services")} className="rounded-lg px-3 py-3 text-left text-sm font-black text-[#19383b] hover:bg-[#e9eee6]">{item}</button>)}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8 lg:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[11px] font-bold text-[#82908a]"><span>Home</span><ChevronRight className="h-3.5 w-3.5" /><span className="text-[#19383b]">Stock</span></div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-[#6d7d76]"><span className="h-2 w-2 rounded-full bg-[#65a272]" /> Open today · until 18:00 <CircleHelp className="h-3.5 w-3.5 text-[#b4872b]" /></div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)] xl:gap-8">
          <aside className="lg:sticky lg:top-[96px]">
            <div className="overflow-hidden rounded-2xl border border-[#d7e0d6] bg-[#fffdf7] shadow-[0_14px_38px_rgba(31,58,55,.07)]">
              <div className="bg-[#19383b] p-5 text-[#f7f3e8]">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#efba50]">Your search</p><p className="mt-1 text-2xl font-black tracking-[-.06em]">{filteredStock.length ? filteredStock.length : "0"} <span className="text-sm font-semibold tracking-normal text-white/55">matches</span></p></div>
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-[#efba50]"><SlidersHorizontal className="h-4 w-4" /></span>
                </div>
                <div className="h-1 rounded-full bg-white/10"><div className="h-full w-[72%] rounded-full bg-[#efba50]" /></div>
                <p className="mt-3 text-[11px] leading-5 text-white/60">{activeFilters ? `${activeFilters} filters are shaping your shortlist.` : "Start with the basics. Refine when you are ready."}</p>
              </div>

              <div className="space-y-6 p-5">
                <label className="block">
                  <FieldLabel icon={Search}>Search</FieldLabel>
                  <div className="relative">
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Make, model or feature" className="h-11 w-full rounded-xl border border-[#d5dfd5] bg-[#f8f8f2] px-3 pr-9 text-xs font-bold text-[#19383b] outline-none transition placeholder:text-[#9ba59d] focus:border-[#b4872b] focus:ring-2 focus:ring-[#e9bb5b]/25" />
                    {query && <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#7c8983] hover:bg-[#e5ebe3]" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
                  </div>
                </label>

                <div>
                  <FieldLabel icon={CarFront}>Make</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {makes.map((item) => <button key={item} type="button" onClick={() => setMake(item)} className={`rounded-full border px-2.5 py-1.5 text-[10px] font-black transition ${make === item ? "border-[#19383b] bg-[#19383b] text-[#f7f3e8]" : "border-[#d5dfd5] bg-[#fffdf7] text-[#5e7069] hover:border-[#b4872b]"}`}>{item}</button>)}
                  </div>
                </div>

                <div>
                  <FieldLabel icon={Banknote}>Budget</FieldLabel>
                  <div className="grid gap-2">
                    {[["under-10", "Under £10,000"], ["under-15", "Under £15,000"]].map(([value, label]) => <button key={value} type="button" onClick={() => setBudget(budget === value ? "" : value)} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-black transition ${budget === value ? "border-[#c8942f] bg-[#fff6df] text-[#19383b]" : "border-[#d5dfd5] text-[#66766f] hover:border-[#b4872b]"}`}><span>{label}</span>{budget === value && <Check className="h-3.5 w-3.5 text-[#b4872b]" />}</button>)}
                  </div>
                </div>

                <div>
                  <FieldLabel icon={Settings2}>Transmission</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {["Automatic", "Manual"].map((item) => <button key={item} type="button" onClick={() => setTransmission(transmission === item ? "" : item)} className={`rounded-xl border px-2 py-2.5 text-[11px] font-black transition ${transmission === item ? "border-[#19383b] bg-[#19383b] text-white" : "border-[#d5dfd5] text-[#66766f] hover:border-[#b4872b]"}`}>{item}</button>)}
                  </div>
                </div>

                <div className="border-t border-[#e2e7df] pt-5">
                  <button type="button" onClick={() => setMoreFilters((open) => !open)} className="flex w-full items-center justify-between text-xs font-black text-[#19383b]"><span className="flex items-center gap-2"><FilterIcon /><span>More filters</span>{activeFilters > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#efba50] px-1 text-[10px] text-[#19383b]">{activeFilters}</span>}</span><ChevronDown className={`h-4 w-4 text-[#78857f] transition-transform ${moreFilters ? "rotate-180" : ""}`} /></button>
                  {moreFilters && <div className="mt-4 space-y-3 rounded-xl bg-[#f1f4ee] p-3">
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-bold text-[#49605a]"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#b4872b]" /> HPI clear only</span><input type="checkbox" checked={hpiClear} onChange={(event) => setHpiClear(event.target.checked)} className="h-4 w-4 accent-[#19383b]" /></label>
                    <label className="flex items-center gap-2 text-xs font-bold text-[#49605a]"><Fuel className="h-4 w-4 text-[#b4872b]" /><select className="w-full bg-transparent text-xs font-bold outline-none" defaultValue=""><option value="">Any fuel type</option><option>Diesel</option><option>Petrol</option><option>Hybrid</option></select></label>
                  </div>}
                </div>

                <button type="button" onClick={resetSearch} className="flex items-center gap-2 text-[11px] font-black text-[#7b8982] transition hover:text-[#19383b]"><RotateCcw className="h-3.5 w-3.5" /> Reset search</button>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#d8e1d7] bg-[#f5f6ef] p-4"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#b4872b]" /><p className="text-[11px] leading-5 text-[#697970]"><strong className="text-[#19383b]">Need a steer?</strong><br />Call 020 8472 9917 and we&apos;ll help narrow it down.</p></div>
          </aside>

          <section className="min-w-0">
            <div className="relative min-h-[350px] overflow-hidden rounded-[24px] bg-[#19383b] shadow-[0_18px_52px_rgba(25,56,59,.18)] sm:min-h-[380px]">
              <div className="absolute inset-0">
                <img src="/__mockup/images/luxxy-rail-showroom-hero.png" alt="Graphite BMW in the Luxxy Motors showroom" className="h-full w-full object-cover object-center opacity-85" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,#19383b_0%,rgba(25,56,59,.94)_29%,rgba(25,56,59,.4)_58%,rgba(25,56,59,.12)_100%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(25,56,59,.4),transparent_44%)]" />
              </div>
              <div className="relative z-10 flex min-h-[350px] max-w-[570px] flex-col justify-center p-7 text-[#f7f3e8] sm:min-h-[380px] sm:p-10">
                <p className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.22em] text-[#efba50]"><Sparkles className="h-4 w-4" /> Carefully selected stock</p>
                <h1 className="max-w-[480px] text-[clamp(2.6rem,5vw,4.9rem)] font-black leading-[.92] tracking-[-.08em]">Find your next car.</h1>
                <p className="mt-5 max-w-[390px] text-sm leading-6 text-white/70 sm:text-base">Quality used vehicles, straightforward buying and a team that knows the difference between a good car and the right one.</p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="rounded-xl bg-[#efba50] px-5 py-3 text-xs font-black text-[#19383b] shadow-lg shadow-[#101f20]/20 transition hover:-translate-y-0.5">See {filteredStock.length || 0} matching cars <ArrowRight className="ml-2 inline h-4 w-4" /></button>
                  <button type="button" onClick={() => setSaved((value) => !value)} className={`rounded-xl border px-4 py-3 text-xs font-black transition ${saved ? "border-[#efba50] bg-[#efba50]/15 text-[#efba50]" : "border-white/25 text-white hover:border-[#efba50]"}`}><Heart className={`mr-2 inline h-4 w-4 ${saved ? "fill-current" : ""}`} /> {saved ? "Search saved" : "Save this search"}</button>
                </div>
              </div>
              <div className="absolute bottom-5 right-5 hidden rounded-xl border border-white/15 bg-[#19383b]/65 p-3 backdrop-blur-md sm:block">
                <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#efba50] text-[#19383b]"><CarFront className="h-4 w-4" /></span><span><span className="block text-[9px] font-black uppercase tracking-[.14em] text-white/55">In the showroom</span><span className="block text-sm font-black text-white">42 vehicles ready to view</span></span></div>
              </div>
            </div>

            <div id="results" className="scroll-mt-24 pt-8">
              <div className="flex flex-col justify-between gap-4 border-b border-[#d6dfd5] pb-5 sm:flex-row sm:items-end">
                <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#b4872b]">The showroom</p><h2 className="mt-1 text-3xl font-black tracking-[-.06em] text-[#19383b]">Available now</h2><p className="mt-2 text-xs font-semibold text-[#798780]">{filteredStock.length} vehicles match your search · updated this morning</p></div>
                <div className="flex items-center gap-2">
                  <label className="hidden items-center gap-2 text-[10px] font-black uppercase tracking-[.14em] text-[#7c8a83] sm:flex"><ArrowDownUp className="h-3.5 w-3.5 text-[#b4872b]" /><select value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-lg border border-[#d5dfd5] bg-[#fffdf7] px-2.5 py-2 text-xs font-bold normal-case tracking-normal text-[#19383b] outline-none"><option>Recommended</option><option>Price: low to high</option><option>Mileage: low to high</option></select></label>
                  <button type="button" onClick={() => setMoreFilters((value) => !value)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#d5dfd5] bg-[#fffdf7] text-[#19383b] hover:border-[#b4872b] lg:hidden" aria-label="Open filters"><SlidersHorizontal className="h-4 w-4" /></button>
                  <span className="grid h-9 w-9 place-items-center rounded-lg border border-[#d5dfd5] bg-[#fffdf7] text-[#b4872b]"><Grid2X2 className="h-4 w-4" /></span>
                </div>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto py-4">
                {["All stock", "Automatic", "Under £10k", "Low mileage"].map((item) => <button key={item} type="button" onClick={() => item === "Automatic" ? setTransmission(transmission === "Automatic" ? "" : "Automatic") : item === "Under £10k" ? setBudget(budget === "under-10" ? "" : "under-10") : item === "All stock" ? resetSearch() : setSort("Mileage: low to high")} className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-black transition ${((item === "Automatic" && transmission === "Automatic") || (item === "Under £10k" && budget === "under-10") || (item === "All stock" && activeFilters === 0)) ? "border-[#19383b] bg-[#19383b] text-white" : "border-[#d5dfd5] bg-[#fffdf7] text-[#63736b] hover:border-[#b4872b]"}`}>{item}</button>)}
              </div>

              {filteredStock.length ? <div className="grid gap-5 md:grid-cols-2">
                {filteredStock.map((car) => (
                  <article key={car.id} className="group overflow-hidden rounded-2xl border border-[#d7e0d6] bg-[#fffdf7] shadow-[0_10px_26px_rgba(31,58,55,.05)] transition hover:-translate-y-1 hover:border-[#b8c59c] hover:shadow-[0_18px_35px_rgba(31,58,55,.1)]">
                    <button type="button" onClick={() => setSelectedCar(car)} className="relative block w-full text-left">
                      <div className="h-[190px] overflow-hidden">{car.image ? <img src={car.image} alt={car.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <MiniCarArt car={car} />}</div>
                      {car.tag && <span className="absolute left-4 top-4 rounded-full bg-[#efba50] px-2.5 py-1 text-[9px] font-black uppercase tracking-[.14em] text-[#19383b]">{car.tag}</span>}
                      <span className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-[#fffdf7]/85 text-[#19383b] backdrop-blur transition hover:bg-[#efba50]"><Heart className="h-4 w-4" /></span>
                    </button>
                    <div className="p-5">
                      <button type="button" onClick={() => setSelectedCar(car)} className="block text-left"><p className="text-lg font-black tracking-[-.045em] text-[#19383b]">{car.name}</p><p className="mt-1 text-xs font-bold text-[#7c8983]">{car.trim}</p></button>
                      <div className="mt-4 grid grid-cols-2 gap-y-3 border-y border-[#e3e8e0] py-4 text-[11px] font-bold text-[#6d7d75]"><span className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-[#b4872b]" /> {car.year}</span><span className="flex items-center gap-2"><Gauge className="h-3.5 w-3.5 text-[#b4872b]" /> {car.mileage}</span><span className="flex items-center gap-2"><Fuel className="h-3.5 w-3.5 text-[#b4872b]" /> {car.fuel}</span><span className="flex items-center gap-2"><Settings2 className="h-3.5 w-3.5 text-[#b4872b]" /> {car.transmission}</span></div>
                      <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[.16em] text-[#89958d]">Our price</p><p className="text-2xl font-black tracking-[-.06em] text-[#19383b]">{car.price}</p></div><button type="button" onClick={() => setSelectedCar(car)} className="rounded-lg bg-[#19383b] px-3 py-2 text-[11px] font-black text-[#f7f3e8] transition hover:bg-[#275457]">View details <ArrowRight className="ml-1 inline h-3.5 w-3.5 text-[#efba50]" /></button></div>
                    </div>
                  </article>
                ))}
              </div> : <div className="rounded-2xl border border-dashed border-[#cbd8cb] bg-[#f8f8f2] px-6 py-16 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e5ece3] text-[#19383b]"><Search className="h-5 w-5" /></span><h3 className="mt-4 text-lg font-black text-[#19383b]">Nothing matches just yet</h3><p className="mt-2 text-sm text-[#78877f]">Try widening your search or clearing one of the filters.</p><button type="button" onClick={resetSearch} className="mt-5 rounded-lg bg-[#19383b] px-4 py-2.5 text-xs font-black text-white">Reset search</button></div>}
            </div>

            <section id="services" className="scroll-mt-24 mt-12 border-t border-[#d6dfd5] pt-8">
              <div className="mb-5 flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#b4872b]">Buying with confidence</p><h2 className="mt-1 text-2xl font-black tracking-[-.05em] text-[#19383b]">The Luxxy difference</h2></div><button type="button" onClick={() => setActiveSection("Warranty")} className="text-xs font-black text-[#19383b] hover:text-[#b4872b]">Why buy from us <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></div>
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-[#19383b] p-5 text-[#f7f3e8]"><ShieldCheck className="h-5 w-5 text-[#efba50]" /><h3 className="mt-4 text-sm font-black">Warranty options</h3><p className="mt-2 text-xs leading-5 text-white/60">Extra peace of mind on eligible vehicles.</p></div><div className="rounded-2xl border border-[#d7e0d6] bg-[#fffdf7] p-5"><MapPin className="h-5 w-5 text-[#b4872b]" /><h3 className="mt-4 text-sm font-black text-[#19383b]">Nationwide delivery</h3><p className="mt-2 text-xs leading-5 text-[#78877f]">Ask us about getting your next car home.</p></div><div className="rounded-2xl border border-[#d7e0d6] bg-[#fffdf7] p-5"><CalendarDays className="h-5 w-5 text-[#b4872b]" /><h3 className="mt-4 text-sm font-black text-[#19383b]">Book a viewing</h3><p className="mt-2 text-xs leading-5 text-[#78877f]">Choose a time that works for you.</p></div></div>
            </section>
          </section>
        </div>
      </main>

      <footer className="mt-10 border-t border-[#d5ded4] bg-[#19383b] text-[#f7f3e8]">
        <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-5 px-5 py-7 sm:flex-row sm:items-center sm:px-8"><div><p className="text-sm font-black tracking-[.16em]">LUXXY MOTORS</p><p className="mt-1 text-[11px] text-white/55">Straightforward buying in Harrow, London.</p></div><div className="flex items-center gap-5 text-[11px] font-bold text-white/65"><button type="button" onClick={() => setSelectedCar(stock[0])} className="hover:text-[#efba50]">Book a viewing</button><a href="tel:02084729917" className="hover:text-[#efba50]">020 8472 9917</a></div></div>
      </footer>

      {selectedCar && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#102427]/55 p-4 backdrop-blur-sm sm:items-center">
          <div role="dialog" aria-modal="true" aria-label={`${selectedCar.name} details`} className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#d5ded4] bg-[#fffdf7] shadow-[0_24px_90px_rgba(7,25,28,.3)]">
            <div className="relative h-44"><MiniCarArt car={selectedCar} /><button type="button" onClick={() => setSelectedCar(null)} aria-label="Close vehicle details" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-[#fffdf7]/85 text-[#19383b]"><X className="h-4 w-4" /></button></div>
            <div className="p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-[#b4872b]">Vehicle details</p><h2 className="mt-1 text-2xl font-black tracking-[-.06em] text-[#19383b]">{selectedCar.name}</h2><p className="mt-1 text-sm font-bold text-[#7b8982]">{selectedCar.trim}</p></div><p className="text-2xl font-black tracking-[-.06em] text-[#19383b]">{selectedCar.price}</p></div><div className="mt-5 grid grid-cols-2 gap-3 text-xs font-bold text-[#687871]"><span className="rounded-xl bg-[#eef2eb] p-3"><CalendarDays className="mb-1 h-4 w-4 text-[#b4872b]" />{selectedCar.year}</span><span className="rounded-xl bg-[#eef2eb] p-3"><Gauge className="mb-1 h-4 w-4 text-[#b4872b]" />{selectedCar.mileage}</span><span className="rounded-xl bg-[#eef2eb] p-3"><Fuel className="mb-1 h-4 w-4 text-[#b4872b]" />{selectedCar.fuel}</span><span className="rounded-xl bg-[#eef2eb] p-3"><Settings2 className="mb-1 h-4 w-4 text-[#b4872b]" />{selectedCar.transmission}</span></div><div className="mt-6 flex flex-col gap-2 sm:flex-row"><a href="tel:02084729917" className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#d4ded4] px-4 py-3 text-xs font-black text-[#19383b] hover:border-[#b4872b]"><Phone className="h-4 w-4" /> Call about this car</a><button type="button" onClick={() => { setSelectedCar(null); setActiveSection("Stock"); }} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#19383b] px-4 py-3 text-xs font-black text-[#f7f3e8] hover:bg-[#275457]"><CalendarDays className="h-4 w-4 text-[#efba50]" /> Book a viewing</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterIcon() {
  return <span className="grid h-5 w-5 place-items-center rounded-md bg-[#f1e7ca] text-[#b4872b]"><SlidersHorizontal className="h-3 w-3" /></span>;
}