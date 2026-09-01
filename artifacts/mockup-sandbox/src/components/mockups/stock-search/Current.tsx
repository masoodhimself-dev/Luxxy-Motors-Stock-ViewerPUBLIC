import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Car,
  ChevronDown,
  Filter,
  Fuel,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import "./_group.css";

type Filters = {
  make: string;
  model: string;
  minPrice: string;
  maxPrice: string;
  fuel: string;
  transmission: string;
  search: string;
  catS: boolean;
  catN: boolean;
  noWriteOff: boolean;
  sort: string;
};

const initialFilters: Filters = {
  make: "",
  model: "",
  minPrice: "",
  maxPrice: "",
  fuel: "",
  transmission: "",
  search: "",
  catS: false,
  catN: false,
  noWriteOff: false,
  sort: "",
};

const cars = [
  { make: "BMW", model: "3 Series", fuel: "Diesel", transmission: "Automatic" },
  { make: "Honda", model: "Civic", fuel: "Petrol", transmission: "Manual" },
  { make: "MG", model: "ZS", fuel: "Petrol", transmission: "Automatic" },
  { make: "Toyota", model: "Yaris", fuel: "Hybrid", transmission: "Automatic" },
];

function SelectField({
  label,
  icon: Icon,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  icon: typeof Car;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="space-y-2">
      <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#66736f]">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <select
        className="h-11 w-full rounded-xl border border-[#d7ddd4] bg-[#fffdf7] px-3 text-sm font-semibold text-[#18363a] outline-none transition focus:border-[#b68729] focus:ring-2 focus:ring-[#e6b34b]/25 disabled:cursor-not-allowed disabled:opacity-45"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Any {label}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function CheckRow({ label, checked, onChange, tone = "ink" }: { label: string; checked: boolean; onChange: (value: boolean) => void; tone?: "ink" | "red" | "gold" }) {
  const checkedClasses = tone === "red"
    ? "border-[#b84b3b] bg-[#b84b3b]"
    : tone === "gold"
      ? "border-[#d59a2a] bg-[#d59a2a]"
      : "border-[#17353a] bg-[#17353a]";

  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm font-bold text-[#274244]">
      <span className={`grid h-5 w-5 place-items-center rounded-md border-2 transition ${checked ? checkedClasses : "border-[#b7c3b9] bg-[#fffdf7]"}`}>
        {checked && <span className="text-[12px] leading-none text-white">✓</span>}
      </span>
      <input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function Current() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const makes = useMemo(() => Array.from(new Set(cars.map((car) => car.make))).sort(), []);
  const models = useMemo(() => Array.from(new Set(cars.filter((car) => !filters.make || car.make === filters.make).map((car) => car.model))).sort(), [filters.make]);
  const activeAdvancedCount = Number(filters.catS) + Number(filters.catN) + Number(filters.noWriteOff);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="stock-search-shell min-h-[100dvh] bg-[#f3f4ee] p-4 text-[#17252a] sm:p-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[24px] border border-[#d9ddd5] bg-[#fdfcf6] shadow-[0_20px_60px_rgba(31,53,53,0.12)]">
        <div className="h-1.5 bg-gradient-to-r from-[#17353a] via-[#e6b34b] to-[#17353a]" />
        <div className="p-5 sm:p-8">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[#b68729]">
                <Sparkles className="h-4 w-4" />
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em]">Browse our stock</p>
              </div>
              <h1 className="text-[clamp(1.8rem,4vw,2.7rem)] font-black tracking-[-0.05em] text-[#17353a]">Find a car you&apos;ll love</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#687773]">Search by make, model, registration or a feature, then refine your shortlist below.</p>
            </div>
            <span className="w-fit rounded-full border border-[#d9ddd5] bg-[#eef1eb] px-3 py-1.5 text-xs font-extrabold text-[#66736f]">42 vehicles in stock</span>
          </div>

          <div className="mb-7 rounded-2xl border border-[#dfe6db] bg-[#eef1eb] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#b68729]" />
                <input
                  aria-label="Search vehicles"
                  placeholder={'Try “BMW”, “Golf”, “automatic” or a registration'}
                  value={filters.search}
                  onChange={(event) => update({ search: event.target.value })}
                  className="h-14 w-full rounded-xl border border-[#d7ddd4] bg-[#fffdf7] pl-12 pr-11 text-sm font-semibold text-[#17353a] outline-none transition placeholder:text-[#899590] focus:border-[#b68729] focus:ring-2 focus:ring-[#e6b34b]/25"
                />
                {filters.search && <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[#83908b] hover:bg-[#eef1eb]" onClick={() => update({ search: "" })}><X className="h-4 w-4" /></button>}
              </div>
              <button type="button" className="h-14 rounded-xl bg-[#17353a] px-7 text-sm font-extrabold text-[#f7f3e8] shadow-lg shadow-[#17353a]/15 transition hover:-translate-y-0.5">Find cars <Search className="ml-2 inline h-4 w-4 text-[#e6b34b]" /></button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
              <span className="mr-1 text-[11px] font-bold text-[#788681]">Quick picks</span>
              {makes.map((make) => <button type="button" key={make} onClick={() => update({ make, model: "" })} className={`rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition ${filters.make === make ? "border-[#17353a] bg-[#17353a] text-white" : "border-[#d1d9cf] bg-[#fffdf7] text-[#294548] hover:border-[#b68729]"}`}>{make}</button>)}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <SelectField label="Make" icon={Car} value={filters.make} options={makes} onChange={(make) => update({ make, model: "" })} />
            <SelectField label="Model" icon={Car} value={filters.model} options={models} disabled={!filters.make} onChange={(model) => update({ model })} />
            <label className="space-y-2"><span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#66736f]"><Banknote className="h-3.5 w-3.5" /> Min price</span><input type="number" placeholder="£ Min" value={filters.minPrice} onChange={(event) => update({ minPrice: event.target.value })} className="h-11 w-full rounded-xl border border-[#d7ddd4] bg-[#fffdf7] px-3 text-sm font-semibold outline-none focus:border-[#b68729] focus:ring-2 focus:ring-[#e6b34b]/25" /></label>
            <label className="space-y-2"><span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#66736f]"><Banknote className="h-3.5 w-3.5" /> Max price</span><input type="number" placeholder="£ Max" value={filters.maxPrice} onChange={(event) => update({ maxPrice: event.target.value })} className="h-11 w-full rounded-xl border border-[#d7ddd4] bg-[#fffdf7] px-3 text-sm font-semibold outline-none focus:border-[#b68729] focus:ring-2 focus:ring-[#e6b34b]/25" /></label>
            <SelectField label="Fuel" icon={Fuel} value={filters.fuel} options={["Diesel", "Hybrid", "Petrol"]} onChange={(fuel) => update({ fuel })} />
            <SelectField label="Transmission" icon={Settings2} value={filters.transmission} options={["Automatic", "Manual"]} onChange={(transmission) => update({ transmission })} />
          </div>

          <div className="mt-7 flex flex-col items-center justify-between gap-4 border-t border-[#e0e3dc] pt-5 md:flex-row">
            <button type="button" onClick={() => setShowAdvanced((open) => !open)} className="relative h-11 w-full rounded-xl border border-[#cfd8ce] bg-[#fffdf7] px-5 text-sm font-extrabold text-[#294548] transition hover:border-[#b68729] md:w-auto">
              <Filter className="mr-2 inline h-4 w-4 text-[#b68729]" /> More filters {activeAdvancedCount > 0 && <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-[#e6b34b] text-[10px] font-black text-[#17353a]">{activeAdvancedCount}</span>} <ChevronDown className={`ml-2 inline h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} />
            </button>
            <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
              <select value={filters.sort} onChange={(event) => update({ sort: event.target.value })} className="h-11 w-full rounded-xl border border-[#d7ddd4] bg-[#fffdf7] px-3 text-sm font-semibold text-[#294548] outline-none sm:w-52"><option value="">Sort: Recommended</option><option>Price: Low to High</option><option>Mileage: Low to High</option></select>
              <button type="button" className="h-11 rounded-xl border border-[#17353a] px-6 text-sm font-extrabold text-[#17353a] transition hover:bg-[#17353a] hover:text-white sm:w-auto">Show results</button>
            </div>
          </div>

          {showAdvanced && <div className="mt-6 border-t border-[#e0e3dc] pt-6"><div className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#66736f]"><AlertTriangle className="h-3.5 w-3.5" /> Condition history</div><div className="flex flex-wrap gap-x-6 gap-y-4 rounded-xl border border-[#dfe6db] bg-[#eef1eb] p-4"><CheckRow label="HPI Clear" checked={filters.noWriteOff} onChange={(noWriteOff) => update({ noWriteOff })} /><CheckRow label="CAT S" tone="red" checked={filters.catS} onChange={(catS) => update({ catS })} /><CheckRow label="CAT N" tone="gold" checked={filters.catN} onChange={(catN) => update({ catN })} /></div></div>}
        </div>
      </div>
    </div>
  );
}