/** Provider-neutral postcode geography. No customer or dealership data is cached here. */
export type PostcodeLocation = { postcode: string; latitude: number | null; longitude: number | null; region: string | null; administrativeArea: string | null };
export type Coordinates = { latitude: number; longitude: number };
export class PostcodeError extends Error {
  constructor(public code: 'invalid' | 'not_found' | 'unavailable' | 'timeout', message: string, public status: number) { super(message); }
}
export function normalisePostcode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}
export function validPostcodeSyntax(value: string): boolean {
  return /^(?:GIR 0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? \d[ABD-HJLNP-UW-Z]{2})$/.test(normalisePostcode(value));
}
export function distanceMiles(a: Coordinates, b: Coordinates): number {
  for (const point of [a,b]) if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude)>90 || Math.abs(point.longitude)>180) throw new RangeError('Valid coordinates are required.');
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude-a.latitude)/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0,h))));
}
export interface PostcodeCache { read(postcode: string): Promise<PostcodeLocation | null>; write(location: PostcodeLocation): Promise<void> }
export function createPostcodeService(options: { cache?: PostcodeCache; transport?: typeof fetch; now?: () => number; timeoutMs?: number } = {}) {
  const now=options.now ?? Date.now, transport=options.transport ?? fetch;
  const memory = new Map<string, { value: PostcodeLocation; expires: number }>();
  const suggestions = new Map<string, { value: string[]; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  const ttl=24*60*60*1000;
  function remember<T>(map: Map<string,{value:T;expires:number}>, key: string, value: T, duration: number) {
    if(map.size>=500) map.delete(map.keys().next().value!);
    map.set(key,{value,expires:now()+duration});
  }
  async function single<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing=pending.get(key); if(existing) return existing as Promise<T>;
    if(pending.size>=32) throw new PostcodeError('unavailable','Postcode lookup is busy. Enter the address manually.',503);
    const promise=work();pending.set(key,promise);
    try { return await promise; } finally { pending.delete(key); }
  }
  async function request(path: string): Promise<unknown> {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),options.timeoutMs ?? 3000);
    try {
      const response=await transport(`https://api.postcodes.io${path}`,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}});
      if(response.status===404) throw new PostcodeError('not_found','Postcode not found. Check it or enter the address manually.',404);
      if(!response.ok) throw new Error('Provider unavailable');
      const body=await response.json() as {status?:number; result?:unknown};
      if(body.status!==200) throw new Error('Invalid provider response');
      return body.result;
    } catch(error) {
      if(error instanceof PostcodeError) throw error;
      throw new PostcodeError(controller.signal.aborted?'timeout':'unavailable', 'Postcode lookup is unavailable. You can still enter the address manually.',controller.signal.aborted?504:503);
    } finally { clearTimeout(timer); }
  }
  function location(raw: unknown): PostcodeLocation {
    if(!raw || typeof raw!=='object') throw new PostcodeError('unavailable','Postcode lookup returned an incomplete response.',503);
    const v=raw as Record<string,unknown>;
    const coordinate=(key:string,limit:number) => v[key]===null ? null : typeof v[key]==='number' && Number.isFinite(v[key]) && Math.abs(v[key] as number)<=limit ? v[key] as number : undefined;
    const latitude=coordinate('latitude',90),longitude=coordinate('longitude',180);
    if(typeof v.postcode!=='string' || !validPostcodeSyntax(v.postcode) || latitude===undefined || longitude===undefined) throw new PostcodeError('unavailable','Postcode lookup returned an incomplete response.',503);
    return {postcode:normalisePostcode(v.postcode),latitude,longitude,region:typeof v.region==='string'?v.region:null,administrativeArea:typeof v.admin_district==='string'?v.admin_district:null};
  }
  async function lookup(input: string): Promise<PostcodeLocation> {
    if(!validPostcodeSyntax(input)) throw new PostcodeError('invalid','Enter a complete UK postcode, for example HA2 7LU.',400);
    const postcode=normalisePostcode(input), cached=memory.get(postcode);
    if(cached && cached.expires>now()) return {...cached.value};
    return single(`lookup:${postcode}`,async()=>{
      let stored:PostcodeLocation|null=null;try{stored=await options.cache?.read(postcode) ?? null;}catch{/* Cache failures do not disable manual entry or the provider. */}
      if(stored){remember(memory,postcode,stored,ttl);return {...stored};}
      const result=location(await request(`/postcodes/${encodeURIComponent(postcode)}`));
      if(result.postcode!==postcode) throw new PostcodeError('unavailable','Postcode lookup returned a different postcode.',503);
      remember(memory,postcode,result,ttl);
      try{await options.cache?.write(result);}catch{/* Successful provider responses remain usable. */}
      return {...result};
    });
  }
  async function autocomplete(input:string):Promise<string[]> {
    const query=input.trim().toUpperCase().replace(/\s+/g,' ');
    if(query.length<2)return [];
    if(query.length>8 || !/^[A-Z\d ]+$/.test(query)) throw new PostcodeError('invalid','Enter the start of a UK postcode.',400);
    const cached=suggestions.get(query);if(cached && cached.expires>now())return [...cached.value];
    return single(`suggest:${query}`,async()=>{
      const raw=await request(`/postcodes?query=${encodeURIComponent(query)}&limit=6`);
      if(raw!==null && !Array.isArray(raw)) throw new PostcodeError('unavailable','Postcode suggestions are unavailable.',503);
      const result=(raw ?? []) as unknown[];
      const values=[...new Set(result.slice(0,6).map(v=>location(v).postcode))];
      if(values.length)remember(suggestions,query,values,5*60*1000);
      return values;
    });
  }
  return {lookup,autocomplete};
}
