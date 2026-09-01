import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Banknote, Car, Check, ChevronDown, Fuel, RotateCcw, Search, Settings2, SlidersHorizontal, Sparkles, X } from "lucide-react";
import "./_group.css";

type SearchState = {
  query: string;
  make: string;
  model: string;
  price: string;
  fuel: string;
  transmission: string;
  hpiClear: boolean;
  catS: boolean;
  catN: boolean;
};

const initialState: SearchState = { query: "", make: "", model: "", price: "", fuel: "", transmission: "", hpiClear: true, catS: false, catN: false };
const stock = [
  { make: "BMW", model: "3 Series", fuel: "Diesel", transmission: "Automatic" },
  { make: "Honda", model: "Civic", fuel: "Petrol", transmission: "Manual" },
  { make: "MG", model: "ZS", fuel: "Petrol", transmission: "Automatic" },
  { make: "Toyota", model: "Yaris", fuel: "Hybrid", transmission: "Automatic" },
];

function Field({ label, icon: Icon, children }: { label: string; icon: typeof Car; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#687773]"><Icon className="h-3.5 w-3.5 text-[#b68729]" /> {label}</span>{children}</label>;
}

function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-[#d6ded4] bg-[#fffdf7] px-3 text-sm font-bold text-[#17353a] outline-none transition focus:border-[#b68729] focus:ring-2 focus:ring-[#e6b34b]/25">{children}</select>;
}

function Toggle({ label, checked, onChange, tone = "ink" }: { label: string; checked: boolean; onChange: (value: boolean) => void; tone?: "ink" | "red" | "gold" }) {
  const color = tone === "red" ? "bg-[#b84b3b]" : tone === "gold" ? "bg-[#d59a2a]" : "bg-[#17353a]";
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#d9e0d7] bg-[#fffdf7] px-3 py-3 text-left text-sm font-extrabold text-[#294548] transition hover:border-[#b68729]"><span className="flex items-center gap-2.5">{checked ? <span className={`grid h-5 w-5 place-items-center rounded-md ${color}`}><Check className="h-3.5 w-3.5 text-white" /></span> : <span className="h-5 w-5 rounded-md border-2 border-[#b8c5ba]" />}{label}</span><span className={`h-1.5 w-8 rounded-full ${checked ? color : "bg-[#d5ddd5]"}`} /></button>;
}

export function AdvancedSearchBeside() {
  const [state, setState] = useState<SearchState>(initialState);
  const [sort, setSort] = useState("Recommended");
  const makes = useMemo(() => Array.from(new Set(stock.map((car) => car.make))).sort(), []);
  const models = useMemo(() => Array.from(new Set(stock.filter((car) => !state.make || car.make === state.make).map((car) => car.model))).sort(), [state.make]);
  const update = (patch: Partial<SearchState>) => setState((current) => ({ ...current, ...patch }));
  const activeCount = Number(Boolean(state.query || state.make || state.model || state.price || state.fuel || state.transmission)) + Number(state.hpiClear) + Number(state.catS) + Number(state.catN);

  return (
    <div className="stock-search-shell min-h-[100dvh] bg-[#f3f4ee] p-4 text-[#17252a] sm:p-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[24px] border border-[#d9ddd5] bg-[#fdfcf6] shadow-[0_20px_60px_rgba(31,53,53,0.12)]">
        <div className="h-1.5 bg-gradient-to-r from-[#17353a] via-[#e6b34b] to-[#17353a]" />
        <div className="p-5 sm:p-8">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><div className="mb-2 flex items-center gap-2 text-[#b68729]"><Sparkles className="h-4 w-4" /><p className="text-[10px] font-extrabold uppercase tracking-[0.2em]">Browse our stock</p></div><h1 className="text-[clamp(1.8rem,4vw,2.7rem)] font-black tracking-[-0.05em] text-[#17353a]">Find a car you&apos;ll love</h1><p className="mt-2 max-w-xl text-sm leading-6 text-[#687773]">Start with a simple search, then fine-tune the details that matter to you.</p></div>
            <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#17353a] text-[#e6b34b]"><Car className="h-4 w-4" /></span><span className="text-xs font-extrabold text-[#66736f]">42 vehicles in stock</span></div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
            <section className="rounded-2xl border border-[#dfe6db] bg-[#eef1eb] p-4 sm:p-5">
              <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#b68729]">01 · Search the showroom</p><h2 className="mt-1 text-xl font-black tracking-[-0.04em] text-[#17353a]">What are you looking for?</h2></div><span className="rounded-full bg-[#fffdf7] px-2.5 py-1 text-[10px] font-black text-[#7b8984]">Start here</span></div>
              <div className="relative"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#b68729]" /><input aria-label="Search the showroom" value={state.query} onChange={(event) => update({ query: event.target.value })} placeholder={'Try “BMW”, “Golf” or a registration'} className="h-14 w-full rounded-xl border border-[#d7ddd4] bg-[#fffdf7] pl-12 pr-11 text-sm font-semibold text-[#17353a] outline-none placeholder:text-[#899590] focus:border-[#b68729] focus:ring-2 focus:ring-[#e6b34b]/25" />{state.query && <button type="button" onClick={() => update({ query: "" })} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[#83908b]"><X className="h-4 w-4" /></button>}</div>
              <div className="mt-5"><p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#687773]">Quick picks</p><div className="flex flex-wrap gap-2">{["Automatic", "Under £20k", "Low mileage", "HPI clear"].map((label) => <button type="button" key={label} onClick={() => update(label === "Automatic" ? { transmission: state.transmission === "Automatic" ? "" : "Automatic" } : label === "HPI clear" ? { hpiClear: !state.hpiClear } : { price: label === "Under £20k" ? "20000" : state.price })} className={`rounded-full border px-3 py-2 text-[11px] font-extrabold transition ${((label === "Automatic" && state.transmission === "Automatic") || (label === "HPI clear" && state.hpiClear) || (label === "Under £20k" && state.price === "20000")) ? "border-[#17353a] bg-[#17353a] text-white" : "border-[#d1d9cf] bg-[#fffdf7] text-[#294548] hover:border-[#b68729]"}`}>{label}</button>)}</div></div>
              <div className="mt-7 border-t border-[#d8e0d5] pt-5"><div className="flex items-center gap-2 text-[11px] font-extrabold text-[#17353a]"><SlidersHorizontal className="h-4 w-4 text-[#b68729]" /> Your search, your shortlist</div><p className="mt-2 text-sm leading-6 text-[#687773]">Use the panel beside this search when you know the exact shape, budget or history you want.</p></div>
            </section>

            <section className="rounded-2xl border border-[#17353a] bg-[#17353a] p-4 text-[#f7f3e8] shadow-[0_14px_35px_rgba(23,53,58,0.18)] sm:p-5">
              <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#e6b34b]">02 · Advanced search</p><h2 className="mt-1 text-xl font-black tracking-[-0.04em]">Refine the details</h2></div><span className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-[#e6b34b]"><Settings2 className="h-4 w-4" /></span></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Make" icon={Car}><Select value={state.make} onChange={(make) => update({ make, model: "" })}><option value="">Any make</option>{makes.map((make) => <option key={make}>{make}</option>)}</Select></Field>
                <Field label="Model" icon={Car}><Select value={state.model} onChange={(model) => update({ model })}><option value="">Any model</option>{models.map((model) => <option key={model}>{model}</option>)}</Select></Field>
                <Field label="Budget" icon={Banknote}><Select value={state.price} onChange={(price) => update({ price })}><option value="">Any price</option><option value="10000">Up to £10,000</option><option value="20000">Up to £20,000</option></Select></Field>
                <Field label="Fuel" icon={Fuel}><Select value={state.fuel} onChange={(fuel) => update({ fuel })}><option value="">Any fuel</option><option>Diesel</option><option>Hybrid</option><option>Petrol</option></Select></Field>
              </div>
              <div className="mt-4"><Field label="Transmission" icon={Settings2}><Select value={state.transmission} onChange={(transmission) => update({ transmission })}><option value="">Any transmission</option><option>Automatic</option><option>Manual</option></Select></Field></div>
              <div className="mt-5 border-t border-white/15 pt-4"><div className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#e7ece4]"><AlertTriangle className="h-3.5 w-3.5 text-[#e6b34b]" /> Condition history</div><div className="grid gap-2 sm:grid-cols-3"><Toggle label="HPI clear" checked={state.hpiClear} onChange={(hpiClear) => update({ hpiClear })} /><Toggle label="CAT S" tone="red" checked={state.catS} onChange={(catS) => update({ catS })} /><Toggle label="CAT N" tone="gold" checked={state.catN} onChange={(catN) => update({ catN })} /></div></div>
            </section>
          </div>

          <div className="mt-5 flex flex-col justify-between gap-3 border-t border-[#e0e3dc] pt-5 sm:flex-row sm:items-center">
            <button type="button" onClick={() => setState(initialState)} className="text-left text-xs font-extrabold text-[#73827d] transition hover:text-[#17353a]"><RotateCcw className="mr-1.5 inline h-3.5 w-3.5" /> Reset search</button>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center"><div className="flex items-center gap-2"><span className="text-[11px] font-bold text-[#81908b]">Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-xl border border-[#d7ddd4] bg-[#fffdf7] px-3 text-sm font-bold text-[#294548] outline-none"><option>Recommended</option><option>Price: low to high</option><option>Mileage: low to high</option></select></div><button type="button" className="h-11 rounded-xl bg-[#e6b34b] px-6 text-sm font-black text-[#17353a] shadow-md shadow-[#b68729]/20 transition hover:-translate-y-0.5">Show {Math.max(12, 42 - activeCount)} results <ArrowRight className="ml-2 inline h-4 w-4" /></button></div>
          </div>
        </div>
      </div>
    </div>
  );
}