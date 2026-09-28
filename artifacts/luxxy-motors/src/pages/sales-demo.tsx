import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  Printer,
  Plus,
  FileText,
} from "lucide-react";
import { useStock } from "@/lib/stock-context";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import {
  vehicleDisplayTitle,
  vehicleRegistration,
  getThumbnailUrl,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SaleDraft,
  emptyDraft,
  totals,
  errors,
} from "@/components/sales-demo/model";

const KEY = "luxxy.sales-workspace-demo.v1";
const tabs = [
  "Customer",
  "Vehicle",
  "Part exchange",
  "Payments",
  "Documents",
  "Handover",
] as const;
const money = (pence: number) =>
  Number.isFinite(pence)
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(pence / 100)
    : "—";
function readDrafts(): SaleDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (d) =>
            d &&
            typeof d.id === "string" &&
            typeof d.price === "string" &&
            typeof d.customer === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export default function SalesDemo() {
  const [, navigate] = useLocation();
  const { stock } = useStock();
  const { settings } = useDealerSettings();
  const [sales, setSales] = useState<SaleDraft[]>(readDrafts);
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const [tab, setTab] = useState(0);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [documentType, setDocumentType] = useState<
    "Sales invoice" | "Deposit receipt"
  >("Sales invoice");
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = Boolean(draft && JSON.stringify(draft) !== snapshot);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const leave = (exit = false) => {
    if (dirty && !window.confirm("Leave without saving these changes?")) return;
    setDraft(null);
    setMessage("");
    setProblems([]);
    if (exit) navigate("/portal");
  };
  const open = (sale: SaleDraft) => {
    setDraft({ ...sale });
    setSnapshot(JSON.stringify(sale));
    setTab(0);
    setMessage("");
    setProblems([]);
  };
  const update = <K extends keyof SaleDraft>(key: K, value: SaleDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setMessage("");
  };
  const save = () => {
    if (!draft) return;
    const next = [...sales.filter((sale) => sale.id !== draft.id), draft];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setSales(next);
      setSnapshot(JSON.stringify(draft));
      setMessage("Draft saved on this device.");
    } catch {
      setMessage("Could not save. Keep this page open and try again.");
    }
  };
  const changeTab = (index: number) => {
    setTab(index);
    setProblems([]);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const field = (key: keyof SaleDraft, label: string, type = "text") => (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <Input
        type={type}
        value={String(draft?.[key] ?? "")}
        onChange={(e) => update(key, e.target.value as never)}
        className="h-12 bg-white"
      />
    </label>
  );
  const selected = stock?.cars.find((car) => car.id === draft?.vehicleId);
  const amount = draft ? totals(draft) : null;
  const print = () => {
    if (!draft) return;
    const found = errors(draft);
    setProblems(found);
    if (!found.length) {
      document.querySelector(".sales-print-copy")?.remove();
      const sheet = document
        .querySelector(".sales-document")
        ?.cloneNode(true) as HTMLElement | undefined;
      if (!sheet) return;
      sheet.classList.add("sales-print-copy");
      sheet.querySelectorAll(".sales-chrome").forEach((node) => node.remove());
      document.body.appendChild(sheet);
      window.addEventListener("afterprint", () => sheet.remove(), {
        once: true,
      });
      window.print();
    }
  };
  return (
    <div className="sales-workspace fixed inset-0 z-[70] flex flex-col bg-[#f3f4f4] text-[#172126]">
      <header className="sales-chrome flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => leave(!draft)}>
            <ArrowLeft size={17} />
            {draft ? "All sales" : "Staff portal"}
          </Button>
          <div>
            <p className="font-semibold">
              {draft ? draft.customer || "New sale" : "Sales workspace"}
            </p>
            <p className="text-xs text-muted-foreground">
              {draft ? draft.id : settings.identity.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {dirty
              ? "Unsaved changes"
              : draft
                ? sales.some((sale) => sale.id === draft.id)
                  ? "Saved draft"
                  : "New draft"
                : "Local demo"}
          </span>
          {draft && (
            <Button onClick={save}>
              <Save size={16} />
              Save draft
            </Button>
          )}
        </div>
      </header>
      <div className="sales-chrome border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
        Design demo · Use sample customer details · Saved on this browser only ·
        No money received, documents issued or emails sent
      </div>
      {!draft ? (
        <main className="mx-auto w-full max-w-6xl overflow-auto p-5 md:p-10">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold">Sales</h1>
              <p className="mt-2 text-muted-foreground">
                Open a draft or start a new sale.
              </p>
            </div>
            <Button onClick={() => open(emptyDraft())}>
              <Plus size={17} />
              New sale
            </Button>
          </div>
          {sales.length ? (
            <div className="divide-y divide-border border border-border bg-white">
              {sales.map((sale) => (
                <button
                  key={sale.id}
                  onClick={() => open(sale)}
                  className="grid w-full gap-2 p-5 text-left hover:bg-secondary md:grid-cols-[1fr_1fr_auto]"
                >
                  <span className="font-semibold">
                    {sale.customer || "Unnamed customer"}
                    <small className="mt-1 block font-normal text-muted-foreground">
                      {sale.id}
                    </small>
                  </span>
                  <span>{sale.vehicle || "Vehicle not selected"}</span>
                  <span>
                    {money(totals(sale).balance)}
                    <small className="block text-muted-foreground">
                      Illustrative balance · Draft
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border bg-white px-6 py-12 text-center">
              <FileText className="mx-auto mb-4" />
              <h2 className="text-lg font-semibold">
                Your first sale starts here
              </h2>
              <p className="mt-2 text-muted-foreground">
                Choose a car, enter a sample customer and preview their
                paperwork.
              </p>
            </div>
          )}
        </main>
      ) : (
        <>
          <nav
            aria-label="Sale sections"
            className="sales-chrome flex shrink-0 overflow-x-auto border-b border-border bg-white px-4 md:px-8"
          >
            {tabs.map((label, index) => (
              <button
                key={label}
                aria-current={tab === index ? "step" : undefined}
                onClick={() => changeTab(index)}
                className={`min-h-14 shrink-0 border-b-2 px-5 text-sm ${tab === index ? "border-primary font-semibold" : "border-transparent text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <main className="sales-workspace-content flex-1 overflow-auto p-4 md:p-8">
            <div
              className={tab === 4 ? "mx-auto max-w-5xl" : "mx-auto max-w-4xl"}
            >
              <div className="sales-chrome mb-6">
                <h1
                  ref={heading}
                  tabIndex={-1}
                  className="text-2xl font-semibold"
                >
                  {tabs[tab]}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {
                    [
                      "Enter the customer once. Their details carry through to the paperwork.",
                      "Choose from current stock, then confirm the agreed selling price.",
                      "Record the allowance agreed for the customer’s car.",
                      "Plan the deposit and balance. All amounts remain illustrative in this demo.",
                      "Check the A4 preview. Print or choose Save as PDF in your browser.",
                      "Plan collection and record the handover checklist.",
                    ][tab]
                  }
                </p>
              </div>
              {problems.length > 0 && (
                <ul
                  role="alert"
                  className="sales-chrome mb-5 list-inside list-disc border border-red-300 bg-red-50 p-4 text-sm text-red-800"
                >
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {tab === 0 && (
                <div className="sales-form-panel">
                  <div className="grid gap-6 sm:grid-cols-2">
                    {field("customer", "Customer name")}
                    {field("phone", "Telephone", "tel")}
                    {field("email", "Email", "email")}
                  </div>
                  <label className="mt-6 grid gap-2 text-sm font-medium">
                    Address
                    <Textarea
                      rows={3}
                      value={draft.address}
                      onChange={(e) => update("address", e.target.value)}
                    />
                  </label>
                </div>
              )}
              {tab === 1 && (
                <div className="sales-form-panel">
                  <label className="grid gap-2 text-sm font-medium">
                    Vehicle
                    <select
                      aria-label="Vehicle"
                      className="h-12 w-full border border-input bg-white px-3"
                      value={draft.vehicleId}
                      onChange={(e) => {
                        const car = stock?.cars.find(
                          (c) => c.id === e.target.value,
                        );
                        if (car)
                          setDraft({
                            ...draft,
                            vehicleId: car.id,
                            vehicle: vehicleDisplayTitle(car),
                            registration: vehicleRegistration(car),
                            price: String(car.price || ""),
                          });
                      }}
                    >
                      <option value="">Choose a car</option>
                      {stock?.cars.map((car) => (
                        <option key={car.id} value={car.id}>
                          {vehicleDisplayTitle(car)} ·{" "}
                          {car.registration || car.plate || ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected && (
                    <div className="my-6 flex flex-wrap items-center gap-5">
                      <img
                        src={getThumbnailUrl(selected)}
                        alt={draft.vehicle}
                        className="aspect-[4/3] w-48 object-cover"
                      />
                      <p className="text-lg font-semibold">{draft.vehicle}</p>
                    </div>
                  )}
                  <div className="mt-6 grid gap-6 sm:grid-cols-2">
                    {field("registration", "Vehicle registration")}
                    {field("price", "Agreed vehicle price (£)")}
                  </div>
                </div>
              )}
              {tab === 2 && (
                <div className="sales-form-panel">
                  <label className="flex min-h-12 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={draft.partExchange}
                      onChange={(e) => update("partExchange", e.target.checked)}
                    />
                    Customer has a part exchange
                  </label>
                  {draft.partExchange ? (
                    <div className="mt-6 grid gap-6 sm:grid-cols-2">
                      {field("pxRegistration", "Part-exchange registration")}
                      {field("pxDescription", "Make and model")}
                      {field("pxValue", "Agreed allowance (£)")}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No part-exchange allowance will be deducted.
                    </p>
                  )}
                </div>
              )}
              {tab === 3 && (
                <div className="sales-form-panel">
                  <div className="grid gap-6 sm:grid-cols-2">
                    {field("deposit", "Illustrative deposit (£)")}
                    <label className="grid gap-2 text-sm font-medium">
                      Expected payment method
                      <select
                        aria-label="Expected payment method"
                        className="h-12 border border-input bg-white px-3"
                        value={draft.paymentMethod}
                        onChange={(e) =>
                          update("paymentMethod", e.target.value)
                        }
                      >
                        {["Bank transfer", "Card", "Cash"].map((method) => (
                          <option key={method}>{method}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <dl className="mt-8 divide-y divide-border">
                    {[
                      ["Vehicle price", amount!.price],
                      ["Part-exchange allowance", -amount!.allowance],
                      ["Illustrative deposit", -amount!.deposit],
                      ["Illustrative balance", amount!.balance],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between py-4">
                        <dt>{label}</dt>
                        <dd className="font-semibold">
                          {money(Number(value))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-sm text-amber-800">
                    No payment has been received. This screen does not reserve
                    or sell the vehicle.
                  </p>
                </div>
              )}
              {tab === 4 && (
                <>
                  <div className="sales-chrome mb-5 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-3 text-sm">
                      Document
                      <select
                        aria-label="Document"
                        value={documentType}
                        onChange={(e) =>
                          setDocumentType(e.target.value as typeof documentType)
                        }
                        className="h-11 border border-input bg-white px-3"
                      >
                        <option>Sales invoice</option>
                        <option>Deposit receipt</option>
                      </select>
                    </label>
                    <Button variant="outline" onClick={print}>
                      <Printer size={16} />
                      Print / Save PDF
                    </Button>
                  </div>
                  <article className="sales-document bg-white">
                    <div className="flex flex-wrap justify-between gap-4 border-b-2 border-slate-800 pb-6">
                      <div>
                        <h2 className="text-2xl font-semibold">
                          {settings.identity.name}
                        </h2>
                        <p className="mt-2 text-sm">
                          {settings.address?.street}
                          <br />
                          {settings.address?.city} {settings.address?.postcode}
                        </p>
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold">
                          {documentType}
                        </h2>
                        <p className="mt-2 text-sm">
                          {draft.id}
                          <br />
                          Draft · {new Date().toLocaleDateString("en-GB")}
                        </p>
                      </div>
                    </div>
                    <p className="my-5 border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                      DEMO — NOT ISSUED · NO PAYMENT RECEIVED
                    </p>
                    <section className="my-6">
                      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                        Prepared for
                      </h3>
                      <p className="mt-2 font-semibold">
                        {draft.customer || "Customer name"}
                      </p>
                      <p className="whitespace-pre-line text-sm">
                        {draft.address}
                      </p>
                      <p className="mt-1 text-sm">
                        {draft.email} {draft.phone}
                      </p>
                    </section>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-y border-border bg-slate-50">
                          <th className="p-3 text-left">Description</th>
                          <th className="p-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="p-3">
                            {draft.vehicle || "Vehicle not selected"}
                            <br />
                            <span className="text-muted-foreground">
                              {draft.registration}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {money(amount!.price)}
                          </td>
                        </tr>
                        {draft.partExchange && (
                          <tr>
                            <td className="p-3">
                              Part exchange · {draft.pxDescription} ·{" "}
                              {draft.pxRegistration}
                            </td>
                            <td className="p-3 text-right">
                              {money(-amount!.allowance)}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td className="p-3">
                            Illustrative deposit · {draft.paymentMethod}
                          </td>
                          <td className="p-3 text-right">
                            {money(-amount!.deposit)}
                          </td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-800">
                          <th className="p-3 text-left">
                            Illustrative balance remaining
                          </th>
                          <td className="p-3 text-right text-lg font-semibold">
                            {money(amount!.balance)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    {documentType === "Deposit receipt" && (
                      <p className="mt-5 text-sm">
                        Receipt layout preview only. A real receipt will be
                        issued only after payment is confirmed.
                      </p>
                    )}
                    <label className="sales-chrome mt-6 grid gap-2 text-sm font-medium">
                      Document notes
                      <Textarea
                        value={draft.notes}
                        onChange={(e) => update("notes", e.target.value)}
                        placeholder="Agreed details to appear on the document"
                      />
                    </label>
                    <p className="mt-6 whitespace-pre-line text-sm">
                      {draft.notes}
                    </p>
                    <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
                      Design preview only. Tax treatment and dealership terms
                      are not configured. Not a VAT invoice or proof of
                      purchase.
                    </footer>
                  </article>
                </>
              )}
              {tab === 5 && (
                <div className="sales-form-panel">
                  {field("collection", "Planned collection date", "date")}
                  <div className="mt-6 divide-y divide-border">
                    {(["preparation", "documents", "handover"] as const).map(
                      (key, i) => (
                        <label
                          key={key}
                          className="flex min-h-14 items-center gap-3"
                        >
                          <input
                            type="checkbox"
                            checked={draft[key]}
                            onChange={(e) => update(key, e.target.checked)}
                          />
                          {
                            [
                              "Vehicle preparation reviewed",
                              "Documents reviewed with customer",
                              "Handover checklist reviewed",
                            ][i]
                          }
                        </label>
                      ),
                    )}
                  </div>
                  <p className="mt-5 text-sm text-muted-foreground">
                    These are draft checklist notes. Completing them does not
                    mark stock sold.
                  </p>
                </div>
              )}
            </div>
          </main>
          <footer className="sales-chrome flex shrink-0 items-center justify-between gap-3 border-t border-border bg-white px-4 py-3 md:px-8">
            <p role="status" className="text-sm text-muted-foreground">
              {message || "Draft workspace · Changes stay local"}
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={tab === 0}
                onClick={() => changeTab(tab - 1)}
              >
                Previous
              </Button>
              {tab < tabs.length - 1 ? (
                <Button onClick={() => changeTab(tab + 1)}>
                  Next
                  <ArrowRight size={16} />
                </Button>
              ) : (
                <Button onClick={save}>Save draft</Button>
              )}
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
