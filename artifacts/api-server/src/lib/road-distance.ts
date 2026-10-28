import type { Coordinates } from './postcodes';
export class RoadDistanceError extends Error {
 constructor(public code:'routing_unavailable'|'routing_not_configured'|'no_route'|'routing_limit',message:string,public status=503){super(message);}
}
export interface RoadDistanceCache {read(key:string):Promise<number|null>;write(key:string,metres:number):Promise<void>}
/** Car routes only. No straight-line fallback, names, street addresses or identifiers sent upstream. */
export function createRoadDistanceService(options:{apiKey:()=>string|undefined;transport?:typeof fetch;cache?:RoadDistanceCache;now?:()=>number;timeoutMs?:number;reserve?:()=>Promise<boolean>} ){
 const now=options.now??Date.now,transport=options.transport??fetch;
 const cache=new Map<string,{metres:number;expires:number}>(),pending=new Map<string,Promise<number>>();
 let minute=0,minuteCount=0,day='',dayCount=0;
 function key(from:Coordinates,to:Coordinates){
  for(const point of [from,to]) if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)throw new RoadDistanceError('no_route','We could not locate a driving route for these postcodes.',422);
  return `ors-car-v1:${from.longitude.toFixed(6)},${from.latitude.toFixed(6)}:${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}`;
 }
 async function metres(from:Coordinates,to:Coordinates):Promise<number>{
  const routeKey=key(from,to),known=cache.get(routeKey);
  if(known && known.expires>now())return known.metres;
  const current=pending.get(routeKey);if(current)return current;
  if(pending.size>=4)throw new RoadDistanceError('routing_limit','Delivery estimates are busy. Please try again shortly.');
  const work=async()=>{
   let stored:number|null=null;try{stored=await options.cache?.read(routeKey)??null;}catch{/* A missing cache does not invent a route. */}
   if(stored!==null && Number.isFinite(stored) && stored>=0){remember(routeKey,stored);return stored;}
   const apiKey=options.apiKey()?.trim();
   if(!apiKey)throw new RoadDistanceError('routing_not_configured','Please contact the dealership for a delivery quote.');
   const currentMinute=Math.floor(now()/60000),currentDay=new Date(now()).toISOString().slice(0,10);
   if(currentMinute!==minute){minute=currentMinute;minuteCount=0;}if(currentDay!==day){day=currentDay;dayCount=0;}
   if(minuteCount>=40 || dayCount>=2000 || (options.reserve && !await options.reserve()))throw new RoadDistanceError('routing_limit','Delivery estimates are temporarily unavailable. Please contact the dealership.');
   minuteCount++;dayCount++;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs??5000);
   try{
    const response=await transport('https://api.openrouteservice.org/v2/directions/driving-car/json',{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({coordinates:[[from.longitude,from.latitude],[to.longitude,to.latitude]],instructions:false,geometry:false,units:'m'})});
    if(response.status===404)throw new RoadDistanceError('no_route','No driving route was found. Please contact us for a delivery quote.',422);
    if(response.status===429)throw new RoadDistanceError('routing_limit','Delivery estimates are temporarily unavailable. Please contact us.');
    if(!response.ok)throw Error('Routing unavailable');
    const body=await response.json() as {routes?:{summary?:{distance?:unknown}}[]};
    const distance=body.routes?.[0]?.summary?.distance;
    if(typeof distance!=='number'||!Number.isFinite(distance)||distance<0||distance>10000000)throw new RoadDistanceError('no_route','We could not calculate a driving route. Please contact us for a quote.',422);
    remember(routeKey,distance);try{await options.cache?.write(routeKey,distance);}catch{/* Only the cache failed; the route is usable. */}return distance;
   }catch(error){if(error instanceof RoadDistanceError)throw error;throw new RoadDistanceError('routing_unavailable','Road mileage is unavailable. Please contact us for a delivery quote.');}
   finally{clearTimeout(timer);}
  };
  const promise=work();pending.set(routeKey,promise);try{return await promise;}finally{pending.delete(routeKey);}
 }
 function remember(key:string,metres:number){if(cache.size>=500)cache.delete(cache.keys().next().value!);cache.set(key,{metres,expires:now()+7*24*60*60000});}
 return {metres};
}
