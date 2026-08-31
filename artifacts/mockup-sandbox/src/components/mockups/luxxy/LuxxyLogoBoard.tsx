import { Check, ChevronRight, Copy, Maximize2, Palette, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import mark1 from "../../../assets/luxxy-mark-1.svg";
import mark2 from "../../../assets/luxxy-mark-2.svg";
import mark3 from "../../../assets/luxxy-mark-3.svg";

type Candidate = {
  id: string;
  title: string;
  descriptor: string;
  src: string;
  note: string;
  recommended?: boolean;
};

const candidates: Candidate[] = [
  { id: "01", title: "The Grounded LX", descriptor: "contained road monogram", src: mark1, note: "Rich in detail, but the internal road language gets busy at small sizes." },
  { id: "02", title: "The Open Road", descriptor: "continuous line monogram", src: mark2, note: "Confident and flexible. Its unboxed silhouette loses authority on dark signage." },
  { id: "03", title: "The Harrow Mark", descriptor: "architectural L/X monogram", src: mark3, note: "Most distinctive as a unit: poised, legible, and built for the real world.", recommended: true },
];

function Lockup({ candidate, inverse = false, mono = false }: { candidate: Candidate; inverse?: boolean; mono?: boolean }) {
  return <div className={`flex items-center gap-3 ${inverse ? "text-[#f1ead3]" : "text-[#17363d]"}`}>
    <img src={candidate.src} alt={`${candidate.title} Luxxy mark`} className={`h-12 w-12 object-contain ${mono ? "grayscale contrast-200 brightness-0 opacity-90" : ""} ${inverse ? "brightness-[4] grayscale contrast-50" : ""}`} />
    <div className="leading-none"><div className="text-[22px] font-bold tracking-[.13em]">LUXXY</div><div className={`mt-1 text-[8px] font-medium tracking-[.26em] ${inverse ? "text-[#deb148]" : "text-[#7e9089]"}`}>MOTORS · HARROW</div></div>
  </div>;
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const [copied, setCopied] = useState(false);
  const copyName = () => { navigator.clipboard?.writeText(candidate.title); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  return <article className={`relative overflow-hidden rounded-[26px] border ${candidate.recommended ? "border-[#c59c45] bg-[#fffcf3]" : "border-[#d3d9ce] bg-[#f8faf4]"}`}>
    {candidate.recommended && <div className="absolute right-0 top-0 rounded-bl-2xl bg-[#17363d] px-4 py-2 text-[9px] font-bold uppercase tracking-[.17em] text-[#f1ead3]">Recommended</div>}
    <div className="grid lg:grid-cols-[245px_1fr]">
      <div className="border-b border-[#dce1d8] bg-[#e6ebe2] p-7 lg:border-b-0 lg:border-r">
        <div className="flex items-start justify-between"><span className="font-mono text-[11px] text-[#8b7446]">CONCEPT {candidate.id}</span><button onClick={copyName} className="rounded-full p-1.5 text-[#60746e] hover:bg-[#d7dfd3]" aria-label={`Copy ${candidate.title}`}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button></div>
        <div className="mt-9 flex h-24 items-center justify-center"><img src={candidate.src} alt="" className="h-24 w-24 object-contain" /></div>
        <h2 className="mt-8 text-xl font-semibold tracking-[-.04em] text-[#17363d]">{candidate.title}</h2>
        <p className="mt-1 text-[10px] uppercase tracking-[.14em] text-[#7b8d85]">{candidate.descriptor}</p>
        <p className="mt-5 text-sm leading-5 text-[#5e716b]">{candidate.note}</p>
        {candidate.recommended && <div className="mt-6 flex items-center gap-2 text-[11px] font-semibold text-[#8a691f]"><Check className="h-4 w-4" /> The chosen direction</div>}
      </div>
      <div className="p-5 sm:p-7">
        <div className="grid gap-3 md:grid-cols-2">
          <Specimen label="Primary lockup" bg="paper"><Lockup candidate={candidate} /></Specimen>
          <Specimen label="Dark application" bg="ink"><Lockup candidate={candidate} inverse /></Specimen>
          <Specimen label="Monochrome decal" bg="brass"><Lockup candidate={candidate} mono /></Specimen>
          <Specimen label="App / social avatar" bg="sage"><div className="flex items-center gap-5"><div className="grid h-16 w-16 place-items-center rounded-[19px] bg-[#17363d] shadow-sm"><img src={candidate.src} alt="" className="h-12 w-12 object-contain brightness-[3.3] saturate-0" /></div><span className="text-xs leading-5 text-[#60746e]">Square, recognisable,<br />ready for a shortcut.</span></div></Specimen>
        </div>
        <div className="mt-3 flex flex-col justify-between gap-4 rounded-2xl border border-[#dce1d8] bg-[#f1f4ed] px-4 py-3 sm:flex-row sm:items-center">
          <div><span className="font-mono text-[9px] tracking-[.13em] text-[#8b7446]">32PX RECOGNISABILITY TEST</span><div className="mt-2 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#17363d]"><img src={candidate.src} alt="" className="h-7 w-7 object-contain brightness-[3.3] saturate-0" /></div><span className="text-xs font-medium text-[#47605b]">Still reads as L/X at a glance</span></div></div>
          <div className="text-left sm:text-right"><p className="font-mono text-[9px] tracking-[.13em] text-[#8b7446]">STATUS</p><p className="mt-1 text-xs font-semibold text-[#17363d]">{candidate.recommended ? "Approved route" : "Hold for review"}</p></div>
        </div>
      </div>
    </div>
  </article>;
}

function Specimen({ label, bg, children }: { label: string; bg: "paper" | "ink" | "brass" | "sage"; children: ReactNode }) {
  const tones = { paper: "bg-[#fffdf6]", ink: "bg-[#17363d]", brass: "bg-[#deb148]", sage: "bg-[#dbe4d8]" };
  return <div className={`min-h-[112px] rounded-2xl ${tones[bg]} p-4`}><p className={`font-mono text-[9px] tracking-[.12em] ${bg === "ink" ? "text-[#d6bf83]" : "text-[#82928b]"}`}>{label.toUpperCase()}</p><div className="mt-4">{children}</div></div>;
}

export default function LuxxyLogoBoard() {
  return <main className="min-h-[100dvh] bg-[#e7ece4] px-4 py-5 text-[#17363d] sm:px-8 sm:py-10">
    <div className="mx-auto max-w-[1240px]">
      <header className="rounded-[30px] bg-[#17363d] px-7 py-8 text-[#f1ead3] shadow-[0_24px_70px_rgba(23,54,61,.14)] sm:px-10 sm:py-11">
        <div className="flex flex-wrap items-center justify-between gap-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full border border-[#deb148]/60"><Palette className="h-4 w-4 text-[#deb148]" /></div><span className="font-mono text-[10px] uppercase tracking-[.2em] text-[#c5d0c3]">Identity study · 04.06</span></div><div className="flex items-center gap-2 rounded-full border border-[#56716d] px-3 py-2 text-[10px] font-medium text-[#d6dfd5]"><Sparkles className="h-3.5 w-3.5 text-[#deb148]" /> Brand direction</div></div>
        <div className="mt-10 grid gap-8 md:grid-cols-[1fr_270px] md:items-end"><div><p className="font-mono text-[10px] tracking-[.2em] text-[#deb148]">LUXXY MOTORS / HARROW</p><h1 className="mt-3 max-w-3xl font-serif text-[clamp(3.4rem,7vw,6rem)] leading-[.83] tracking-[-.06em]">A mark with<br /><em className="text-[#deb148]">real road presence.</em></h1></div><p className="border-l border-[#56716d] pl-5 text-sm leading-6 text-[#c8d0c6]">Three supplied L/X concepts tested as a complete working identity — not just a square on a presentation slide.</p></div>
      </header>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="rounded-[24px] border border-[#d3d9ce] bg-[#f7f9f3] p-6 sm:p-8"><p className="font-mono text-[10px] tracking-[.15em] text-[#8b7446]">DECISION CRITERIA</p><div className="mt-5 grid gap-5 sm:grid-cols-3">{[["Ownable", "A road-inspired L/X with a silhouette no generic dealer can borrow."], ["Versatile", "Works on a header, a number plate decal, a social avatar and a fascia."], ["Human", "Premium without the usual cold, black-car-showroom theatre."]].map(([title, text], i) => <div key={title} className="border-l border-[#deb148] pl-4"><span className="font-mono text-xs text-[#8b7446]">0{i + 1}</span><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-2 text-xs leading-5 text-[#667871]">{text}</p></div>)}</div></div>
        <aside className="rounded-[24px] bg-[#deb148] p-6 text-[#17363d]"><Maximize2 className="h-5 w-5" /><h2 className="mt-5 font-serif text-3xl leading-none">Designed at every distance.</h2><p className="mt-3 text-xs leading-5 text-[#5c4b26]">Large-scale showroom certainty. Small-scale digital clarity.</p></aside>
      </section>

      <section className="mt-9 space-y-5">{candidates.map(candidate => <CandidateRow key={candidate.id} candidate={candidate} />)}</section>
      <footer className="mt-8 flex flex-col justify-between gap-5 border-t border-[#c9d1c6] py-8 text-xs text-[#60746e] sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] tracking-[.16em] text-[#8b7446]">RECOMMENDATION</p><p className="mt-2 max-w-xl text-sm leading-6">Proceed with <strong className="text-[#17363d]">Concept 03, The Harrow Mark.</strong> The framed, architectural geometry makes it feel established, while the road-like L/X remains unmistakable when the logo has only a few pixels to work with.</p></div><button className="flex items-center gap-2 self-start rounded-full bg-[#17363d] px-4 py-2.5 font-semibold text-[#f1ead3] hover:bg-[#2d5356]">Approve Concept 03 <ChevronRight className="h-4 w-4" /></button></footer>
    </div>
  </main>;
}