import { useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { StaffMotLookupDialog } from "../mot-history";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import "./enquiry-text-checks.css";

export type EnquiryReference = { start: number; end: number; text: string; value: string; kind: "registration" | "postcode" };
/** Suggestions only: existence is verified by the provider after a staff action. */
export function enquiryReferences(text: string): EnquiryReference[] {
  const found: EnquiryReference[] = [];
  const excluded = [...text.matchAll(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)].map(m => [m.index!, m.index! + m[0].length]);
  const patterns = [
    { kind: "postcode" as const, pattern: /\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi },
    { kind: "registration" as const, pattern: /\b(?:[A-Z]{2}\d{2}\s?[A-Z]{3}|[A-Z]\d{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?\d{1,3}[A-Z])\b/gi },
  ];
  for (const { kind, pattern } of patterns) for (const match of text.matchAll(pattern)) {
    const start = match.index!, end = start + match[0].length;
    if (excluded.some(([a,b]) => start < b && end > a) || found.some(r => start < r.end && end > r.start)) continue;
    const compact = match[0].toUpperCase().replace(/\s/g, "");
    found.push({ start, end, text: match[0], kind, value: kind === "postcode" ? `${compact.slice(0,-3)} ${compact.slice(-3)}` : compact });
  }
  return found.sort((a,b) => a.start - b.start);
}

type Distance = { miles: number | null; approximate: boolean; distanceBasis?: string };
function RoadDistanceDialog({ postcode, onClose, trigger }: { postcode: string; onClose: () => void; trigger: React.RefObject<HTMLButtonElement | null> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Distance | null>(null);
  const [error, setError] = useState("");
  async function check() {
    setBusy(true); setError(""); setResult(null);
    try {
      const reply = await customFetch<Distance>(`/api/postcodes/distance?postcode=${encodeURIComponent(postcode)}&basis=road`);
      if (reply.miles === null || !Number.isFinite(reply.miles) || reply.miles < 0 || reply.distanceBasis !== "driving") throw new Error();
      setResult(reply);
    } catch { setError("Road distance could not be checked. Confirm the postcode and dealership address, then try again."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="portal-action-dialog max-w-lg" onCloseAutoFocus={event => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}>
      <DialogHeader><DialogTitle>Distance to dealership</DialogTitle><DialogDescription>Possible customer postcode: {postcode}. Check the one-way driving distance from this dealership. This does not book delivery or change the enquiry.</DialogDescription></DialogHeader>
      <Button type="button" disabled={busy} onClick={() => void check()}>{busy ? "Checking road distance…" : result ? "Check again" : "Check road distance"}</Button>
      {result && <p role="status"><strong>{result.miles!.toLocaleString("en-GB", { maximumFractionDigits: 1 })} road miles</strong> · estimated one-way distance between postcodes.</p>}
      {error && <p role="alert">{error}</p>}
      <p className="text-sm text-muted-foreground">Road routing by openrouteservice · © OpenStreetMap contributors</p>
    </DialogContent>
  </Dialog>;
}

/** No lookups while rendering or scanning messages. Original wording remains intact. */
export function EnquiryTextChecks({ text }: { text: string }) {
  const [active, setActive] = useState<EnquiryReference | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const references = enquiryReferences(text);
  let end = 0;
  const nodes = references.flatMap(reference => {
    const before = text.slice(end, reference.start); end = reference.end;
    return [before, <button className="enquiry-inline-check" type="button" key={reference.start} title={`Possible ${reference.kind}: ${reference.value}`} aria-label={reference.kind === "postcode" ? `Check road distance from ${reference.value}` : `Check MOT history for ${reference.value}`} onClick={event => { trigger.current = event.currentTarget; setActive(reference); }}>{reference.text}</button>];
  });
  return <>{nodes}{text.slice(end)}{active?.kind === "registration" && <StaffMotLookupDialog key={active.value} initialRegistration={active.value} returnFocusRef={trigger} onClose={() => setActive(null)} />}{active?.kind === "postcode" && <RoadDistanceDialog key={active.value} postcode={active.value} trigger={trigger} onClose={() => setActive(null)} />}</>;
}
