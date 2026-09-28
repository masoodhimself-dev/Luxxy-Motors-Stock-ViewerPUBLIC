import type { FilterState } from '@/components/filters';
import type { Car } from './stock-context';
export function parseStockSearch(text: string, cars: Car[]): Partial<FilterState> {
 let remaining = text; const parsed: Partial<FilterState> = {};
 const budget = remaining.match(/\b(?:under|below|up to)\s*£?([\d,]+(?:\.\d+)?)\s*(k)?\b/i);
 if (budget) { parsed.maxPrice = String(Number(budget[1].replaceAll(',', '')) * (budget[2] ? 1000 : 1)); remaining = remaining.replace(budget[0], ' '); }
 for (const key of ['make','fuel','transmission'] as const) {
  const values = [...new Set(cars.map(car=>car[key]).filter((v):v is string=>Boolean(v)))].sort((a,b)=>b.length-a.length);
  for (const value of values) {
   const words = remaining.toLowerCase().split(/\s+/); const target = value.toLowerCase().split(/\s+/);
   const start = words.findIndex((_,i)=>target.every((word,j)=>words[i+j]===word));
   if(start>=0) { parsed[key]=value; words.splice(start,target.length); remaining=words.join(' '); break; }
  }
 }
 return {...parsed, search: remaining.trim().replace(/\s+/g,' ')};
}
