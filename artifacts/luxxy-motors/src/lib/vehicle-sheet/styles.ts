import { embeddedCss } from './generated-assets';

// Keep the bundled, licensed print fonts and A4 geometry. These refinements are
// shared by the proof, browser print and the PDF's prepared document.
export const vehicleSheetRefinementsCss = `
.lvs-header{min-height:15mm;padding-bottom:2.5mm}
.lvs-logo{max-width:54mm!important;max-height:13mm}
.lvs-identity{grid-template-columns:minmax(0,1fr) 45mm;gap:5mm;min-height:29mm;padding:4mm 0 3mm}
.lvs-page h1{font-size:23pt;line-height:1.1;letter-spacing:-.6pt}
.lvs-price{font-size:27pt;line-height:1.1;letter-spacing:-.7pt}
.lvs-variant{margin-top:1.5mm!important;line-height:1.35}
.lvs-overview{gap:5mm;margin-bottom:3mm}
.lvs-gallery.lvs-supports-removed{grid-template-columns:minmax(0,1fr)}
.lvs-gallery .lvs-main-photo{height:60mm;max-height:60mm;object-fit:contain}
.lvs-supports{height:60mm;grid-template-rows:repeat(2,minmax(0,1fr))}
.lvs-supports img{height:100%;max-height:29mm;object-fit:contain}
.lvs-supports img:only-child{max-height:60mm;grid-row:1 / -1}
.lvs-facts{column-gap:3mm;row-gap:2mm}
.lvs-fact{padding-top:1.2mm}
.lvs-mot{border-top:.3mm solid var(--lvs-line);margin-top:2.5mm;padding-top:2mm;font-size:10pt;line-height:1.35}
.lvs-mot strong{display:block;font-weight:700;overflow-wrap:anywhere}
.lvs-mot p{margin-top:.7mm;color:var(--lvs-muted);font-size:10pt}
.lvs-included{border-top:0;border-left:.8mm solid var(--lvs-accent);background:#f5f6f7;padding:2mm 3mm;margin-top:2mm}
.lvs-included .lvs-history{margin-top:0!important;line-height:1.35}
.lvs-footer{min-height:44mm;padding-top:2.5mm}
.lvs-qr-band{padding-top:2.5mm;gap:5mm}
.lvs-qr-copy h2{font-size:13pt;line-height:1.2;margin-bottom:1mm}
.lvs-viewing-contact{font-size:11pt;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
.lvs-opening-hours{font-size:10pt;line-height:1.35;overflow-wrap:anywhere;margin-top:1mm!important}
.lvs-contact{margin-top:1mm!important;line-height:1.3}
.lvs-complete{margin-top:1.5mm!important;font-size:10pt;line-height:1.3}
.lvs-url{margin-top:.7mm;font-size:9pt;line-height:1.3}
.lvs-bottom{margin-top:2mm;padding-top:1.5mm}
.lvs-tight .lvs-mot{margin-top:2mm;padding-top:1.5mm}
.lvs-tight .lvs-included{padding:1.5mm 3mm}
.lvs-mono .lvs-included{background:#fff;border-color:#444}
`;

export function installVehicleSheetStyles(doc:Document):void {if(doc.querySelector('style[data-luxxy-vehicle-sheet]'))return;const style=doc.createElement('style');style.dataset.luxxyVehicleSheet='1';style.textContent=embeddedCss+vehicleSheetRefinementsCss;doc.head.appendChild(style);}
