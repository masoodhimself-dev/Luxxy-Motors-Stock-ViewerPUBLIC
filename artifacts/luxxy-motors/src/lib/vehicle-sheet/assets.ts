import type { VehicleSheetData, LoadedAssets } from './types';
import { list, text, SheetInputError } from './validation';
export async function loadFonts(doc: Document, plate: boolean): Promise<void> {
  const specs=['400 10pt "LuxxySheetSans"','700 10pt "LuxxySheetSans"',...(plate?['400 18pt "LuxxySheetPlate"']:[])];
  const fonts=await Promise.all(specs.map(s=>doc.fonts.load(s)));
  if(fonts.some(f=>!f.length)||specs.some(s=>!doc.fonts.check(s)))throw new SheetInputError('FONT_LOAD_FAILED','The bundled document fonts could not be loaded. Export is blocked.');
  await doc.fonts.ready;
}
export async function loadAssets(doc: Document,data: VehicleSheetData, timeoutMs=15000, signal?: AbortSignal): Promise<LoadedAssets> {
  const out: LoadedAssets={photos:[],warnings:[],failedAssets:[]};
  const load=(src:string)=>new Promise<{src:string;width:number;height:number}>((resolve,reject)=>{
    if(!/^(data:image\/(?:png|jpeg|webp|gif|svg\+xml);|https?:\/\/|blob:|file:\/\/|\.{0,2}\/|[^:]+$)/i.test(src)){reject(new Error('Unsupported image source'));return;}
    const image=new (doc.defaultView!.Image)();let done=false;const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=null;image.onerror=null;if(error)reject(error);else resolve({src,width:image.naturalWidth,height:image.naturalHeight});};
    const abort=()=>finish(new Error('Cancelled'));const timer=setTimeout(()=>finish(new Error('Image timeout')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});image.onload=async()=>{try{await image.decode();image.naturalWidth&&image.naturalHeight?finish():finish(new Error('Empty image'));}catch{finish(new Error('Image decode failed'));}};image.onerror=()=>finish(new Error('Image load failed'));image.src=src;if(signal?.aborted)abort();
  });
  if(text(data.dealer?.logoUrl))try{await load(data.dealer!.logoUrl!);out.logo=data.dealer!.logoUrl;}catch{out.failedAssets.push('dealer.logoUrl');out.warnings.push('Dealer logo could not be loaded; the supplied dealer name is used.');}
  const candidates=list(data.vehicle.photos).map((p,i)=>({src:typeof p==='string'?p:p.src,alt:typeof p==='string'?'Vehicle photograph':p.alt||'Vehicle photograph',originalIndex:i})).filter(p=>text(p.src));
  // A bounded candidate pool prevents an accidental 98-photo catalogue from blocking a summary export.
  const loaded=await Promise.all(candidates.slice(0,12).map(async p=>{try{return {...p,...await load(p.src)};}catch{out.failedAssets.push(`vehicle.photos[${p.originalIndex}]`);return null;}}));
  out.photos=loaded.filter((p):p is NonNullable<typeof p>=>!!p).slice(0,3);
  if(out.failedAssets.some(x=>x.startsWith('vehicle.')))out.warnings.push('Failed photographs were removed; no replacement image or empty frame was inserted.');
  if(candidates.length>12)out.warnings.push('Only the first 12 photo candidates were checked; the first 3 usable photographs are shown.');
  return out;
}
