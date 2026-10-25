import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VehicleSheetPage,selectedFeatures } from './view';
import { installVehicleSheetStyles } from './styles';
import { loadAssets,loadFonts } from './assets';
import { createVehicleQr } from './qr';
import { validateData,validateVehiclePageUrl,SheetInputError,text,list,highlight } from './validation';
import type {VehicleSheetData,SheetOptions,FitResult,FitPlan,FitMetrics} from './types';
const mm=(px:number)=>px*25.4/96;
const near=(a:number,b:number)=>Math.abs(a-b)<.4;
export function measurePage(page:HTMLElement):FitMetrics {
 const box=page.getBoundingClientRect(),flow=page.querySelector('.lvs-flow')!.getBoundingClientRect(),footer=page.querySelector('.lvs-footer')!.getBoundingClientRect();
 const style=page.ownerDocument.defaultView!.getComputedStyle(page);const left=box.left+parseFloat(style.paddingLeft),right=box.right-parseFloat(style.paddingRight),bottom=box.bottom-parseFloat(style.paddingBottom);const collisions:string[]=[];
 if(!near(mm(box.width),210)||!near(mm(box.height),297))collisions.push('A4 dimensions changed by host styles or transforms.');
 const elements=Array.from(page.querySelectorAll<HTMLElement>('[data-lvs-text], .lvs-gallery img, .lvs-qr, .lvs-logo'));
 for(const [i,el] of elements.entries()) {const r=el.getBoundingClientRect();if(r.width===0||r.height===0){if(el.textContent?.trim())collisions.push(`Content ${i} was hidden by host styles.`);continue;}
  if(r.left<left-.7||r.right>right+.7||r.top<box.top+parseFloat(style.paddingTop)-.7||r.bottom>bottom+.7)collisions.push(`Content ${i} outside printer-safe content area.`);
  if(el.scrollHeight>el.clientHeight+1&&page.ownerDocument.defaultView!.getComputedStyle(el).display!=='inline')collisions.push(`Content ${i} overflows vertically.`);
  if(el.scrollWidth>el.clientWidth+1&&page.ownerDocument.defaultView!.getComputedStyle(el).display!=='inline')collisions.push(`Content ${i} overflows horizontally.`);
  if(el.hasAttribute('data-lvs-text')){const range=page.ownerDocument.createRange();range.selectNodeContents(el);for(const t of Array.from(range.getClientRects())){if(t.left<r.left-1||t.right>r.right+1)collisions.push(`Text ${i} crosses its layout boundary.`);}}
 }
 for(let i=0;i<elements.length;i++)for(let j=i+1;j<elements.length;j++){const a=elements[i],b=elements[j];if(a.contains(b)||b.contains(a))continue;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)collisions.push(`Content collision ${i}/${j}.`);}
 for(const el of page.querySelectorAll('.lvs-summary,.lvs-qualification,.lvs-features li,.lvs-history,.lvs-costs dd,.lvs-fact dd,.lvs-disclosures p,.lvs-contact,.lvs-price-note'))if(parseFloat(page.ownerDocument.defaultView!.getComputedStyle(el).fontSize)*.75<9.95)collisions.push('Body text is below the minimum 10 pt size.');
 const overflow=Math.max(0,mm(footer.bottom-bottom),mm(flow.bottom-footer.top));
 return {pageWidthMm:mm(box.width),pageHeightMm:mm(box.height),flowBottomMm:mm(flow.bottom-box.top),footerTopMm:mm(footer.top-box.top),footerBottomMm:mm(footer.bottom-box.top),bodyFontPt:parseFloat(style.fontSize)*.75,overflowMm:overflow,collisions:[...new Set(collisions)]};
}
export async function prepareVehicleSheet(host:HTMLElement,data:VehicleSheetData,options:SheetOptions,signal?:AbortSignal):Promise<FitResult>{
 const result:FitResult={status:'invalid-data',decisions:[],warnings:[],failedAssets:[],photosShown:0,highlightsShown:[]};
 const doc=host.ownerDocument;installVehicleSheetStyles(doc);host.classList.add('lvs-host');host.dataset.lvsStatus='preparing';
 const cancelled=()=>{if(signal?.aborted)throw new SheetInputError('CANCELLED','Rendering was superseded or cancelled.');};
 try {
  cancelled();validateData(data);if(options.assetTimeoutMs!==undefined&&(!Number.isFinite(options.assetTimeoutMs)||options.assetTimeoutMs<=0))throw new SheetInputError('INVALID_TIMEOUT','assetTimeoutMs must be a positive finite number.');if(options.printAccentColour&&!/^#[0-9a-f]{6}$/i.test(options.printAccentColour))throw new SheetInputError('INVALID_COLOUR','printAccentColour must be a six-digit hex colour.');
  const exact=validateVehiclePageUrl(data.document.vehiclePageUrl,options);result.vehiclePageUrl=exact;
  const [assets]=await Promise.all([loadAssets(doc,data,options.assetTimeoutMs,signal),loadFonts(doc,!!text(data.vehicle.registrationNumber))]);cancelled();
  result.warnings.push(...assets.warnings);result.failedAssets=assets.failedAssets;
  const qr=createVehicleQr(exact);let plan:FitPlan={spacing:'normal',supportingPhotos:true,optionalFeatureLimit:10,summary:'normal'};
  const plans:{plan:FitPlan;step?:string;detail?:string}[]=[{plan:{...plan}}];
  const next=(step:string,detail:string,changes:Partial<FitPlan>)=>{plan={...plan,...changes};plans.push({plan:{...plan},step,detail});};
  next('tighten-spacing','Reduced only optional section and list spacing.',{spacing:'tight'});
  if(assets.photos.length>1)next('remove-supporting-photos','Retained the main photograph and removed optional supporting views.',{supportingPhotos:false});
  const optionalCount=list(data.vehicle.featureHighlights).map(highlight).filter(x=>text(x.text)&&!x.required).length;
  for(let count=Math.min(10,optionalCount)-1;count>=6;count--)next('reduce-feature-highlights',`Retained all required highlights and the first ${count} optional highlights.`,{optionalFeatureLimit:count});
  if(text(data.vehicle.descriptionSummaryShort)&&data.vehicle.shortSummaryPreservesMaterialFacts===true&&text(data.vehicle.descriptionSummaryShort)!==text(data.vehicle.descriptionSummary))next('use-supplied-short-summary','Used the supplied shorter summary with caller attestation; all separate qualifications remain.',{summary:'short'});
  else if(text(data.vehicle.descriptionSummaryShort)&&data.vehicle.shortSummaryPreservesMaterialFacts!==true)result.warnings.push('Short summary was not used: shortSummaryPreservesMaterialFacts was not true.');
  // The printed sheet is an excerpt. Protected disclosures remain separate and uncut.
  for(const limit of [900,650,450,280,140,60])next('shorten-summary',`Shortened optional description to ${limit} characters with an ellipsis; full details remain online.`,{summary:'normal',summaryMaxChars:limit});
  next('reduce-feature-highlights','Retained required features and four optional highlights.',{optionalFeatureLimit:4});
  next('reduce-feature-highlights','Retained required features and two optional highlights.',{optionalFeatureLimit:2});
  for(const candidate of plans){cancelled();host.dataset.lvsStatus='measuring';if(candidate.step)result.decisions.push({step:candidate.step,detail:candidate.detail!});result.plan=candidate.plan;
   host.innerHTML=renderToStaticMarkup(<VehicleSheetPage data={data} assets={assets} plan={candidate.plan} qr={qr} options={options}/>);
   await Promise.all(Array.from(host.querySelectorAll('img')).map(img=>img.decode()));await doc.fonts.ready;await new Promise<void>(r=>doc.defaultView!.requestAnimationFrame(()=>doc.defaultView!.requestAnimationFrame(()=>r())));cancelled();
   const page=host.querySelector<HTMLElement>('.lvs-page')!;result.metrics=measurePage(page);result.photosShown=candidate.plan.supportingPhotos?assets.photos.length:Math.min(assets.photos.length,1);result.highlightsShown=selectedFeatures(data,candidate.plan).map(x=>x.text);
   if(result.metrics.overflowMm<.15&&result.metrics.collisions.length===0){result.status='ready';host.dataset.lvsStatus='ready';return result;}
  }
  result.status='overflow';result.code='CONTENT_OVERFLOW';result.message='Required content cannot fit safely on one A4 page. No PDF may be generated. Supply less optional content or review the supplied summaries; preserve every material disclosure.';
 }catch(error){const e=error instanceof Error?error:new Error(String(error));if(signal?.aborted){result.status='cancelled';result.code='CANCELLED';return result;}result.code=e instanceof SheetInputError?e.code:'RENDER_FAILED';result.message=e.message;result.status=result.code==='CANCELLED'?'cancelled':/URL|ORIGIN|PATH/.test(result.code)?'invalid-url':/FONT|IMAGE|RENDER/.test(result.code)?'asset-error':'invalid-data';}
 if(result.status!=='cancelled'){host.dataset.lvsStatus=result.status;const error=doc.createElement('div');error.className='lvs-error';error.setAttribute('role','alert');error.textContent=`${result.code}: ${result.message}`;host.replaceChildren(error);}return result;
}
