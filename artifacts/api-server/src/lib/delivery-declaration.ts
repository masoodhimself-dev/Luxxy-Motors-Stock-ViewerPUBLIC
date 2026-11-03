import type { DeliverySnapshot } from "./delivery-evidence";
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** A4 ledger format, deliberately separate from an invoice or waiver of customer rights. */
export function deliveryDeclarationHtml(
  snapshot: DeliverySnapshot,
  issuedAt: string,
) {
  const s = Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key, escape(value)]),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Delivery declaration · ${s.saleReference}</title><style>
 @page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;color:#192a36;background:#edf0f2;font:12px Arial,sans-serif;line-height:1.6}.sheet{background:white;max-width:210mm;min-height:280mm;margin:20px auto;padding:16mm}.head{border-bottom:3px solid #192a36;display:flex;justify-content:space-between;gap:20px;padding-bottom:16px}h1{font-size:22px;margin:0}h2{font-size:14px;margin:24px 0 8px}.muted{color:#5b6670}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px}.row{border-bottom:1px solid #dce2e7;padding:8px 0}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}.field{min-height:31px;border-bottom:1px solid #b7c1c8}.notes{height:85px;border:1px solid #b7c1c8}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px}.toolbar{text-align:center;padding:16px}button{font:inherit;padding:10px 18px;cursor:pointer}.footer{border-top:1px solid #dce2e7;margin-top:24px;padding-top:10px;font-size:10px}@media print{body{background:white}.toolbar{display:none}.sheet{margin:0;padding:0;min-height:0;max-width:none}}
 </style></head><body><div class="toolbar"><button onclick="window.print()">Print declaration</button></div><main class="sheet"><header class="head"><div><h1>${s.dealerName}</h1><div>Delivery &amp; vehicle condition declaration</div></div><div><strong>${s.saleReference}</strong><br><span class="muted">Prepared ${escape(issuedAt.slice(0, 10))}</span></div></header>
 <section class="grid"><div class="row"><div class="label">Vehicle</div>${s.vehicle}<br><strong>${s.registration}</strong></div><div class="row"><div class="label">Customer / recipient</div>${s.customer}<br>${s.recipient}</div><div class="row"><div class="label">Delivery address</div>${s.address}</div><div class="row"><div class="label">Planned delivery</div>${s.scheduledDate} ${s.timeWindow}<br>Driver: ${s.driver || "____________________"}</div></section>
 <h2>Record the actual handover</h2><div class="grid"><div><div class="label">Date and time</div><div class="field"></div></div><div><div class="label">Mileage</div><div class="field"></div></div><div><div class="label">Keys supplied</div><div class="field"></div></div><div><div class="label">Documents and agreed items supplied</div><div class="field"></div></div></div>
 <h2>Visible condition, damage and any exceptions</h2><div class="notes"></div><p>☐ Delivered &nbsp;&nbsp; ☐ Delivery not completed — record the reason above.</p><p>I acknowledge the vehicle, keys and documents described above were presented at the recorded time. Any condition concerns or missing items are recorded above. This record does not confirm payment, decide liability or affect statutory rights.</p>
 <div class="signatures"><div><div class="label">Recipient name and signature</div><div class="field"></div><div class="field"></div></div><div><div class="label">Driver name and signature</div><div class="field"></div><div class="field"></div></div></div>
 <div class="footer">Keep the signed original. Upload a clear copy to this sale when reception returns. The actual handover time and later upload time must be recorded separately. Delivery instructions: ${s.instructions || "None recorded."}</div></main></body></html>`;
}
