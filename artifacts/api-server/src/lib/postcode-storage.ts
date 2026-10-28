import { pool } from '@workspace/db';
import { createPostcodeService, normalisePostcode, type PostcodeLocation } from './postcodes';
import type { SettingsQueryClient } from './settings-versions';
let lastPruned=0;
export const postcodeService=createPostcodeService({cache:{
  async read(postcode){const result=await pool.query('SELECT data FROM postcode_lookup_cache WHERE postcode=$1 AND expires_at>now()',[postcode]);return result.rows[0]?.data ?? null;},
  async write(location){await pool.query("INSERT INTO postcode_lookup_cache(postcode,data,expires_at) VALUES($1,$2::jsonb,now()+interval '24 hours') ON CONFLICT(postcode) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at",[location.postcode,JSON.stringify(location)]);if(Date.now()-lastPruned>60*60*1000){lastPruned=Date.now();await pool.query('DELETE FROM postcode_lookup_cache WHERE postcode IN (SELECT postcode FROM postcode_lookup_cache WHERE expires_at<now() LIMIT 1000)');}},
}});
export function settingsPostcode(config:Record<string,unknown>):string {
  const address=config.address as Record<string,unknown>|undefined;return typeof address?.postcode==='string'?normalisePostcode(address.postcode):'';
}
/** Called inside the same settings transaction. Never calls a network provider under the lock. */
export async function persistDealerLocation(client:SettingsQueryClient,dealerId:string,config:Record<string,unknown>,verified:PostcodeLocation|null) {
  const postcode=settingsPostcode(config);
  // Also prevents an old lookup result being saved for a newer/restored address.
  if(!verified || verified.postcode!==postcode || verified.latitude===null || verified.longitude===null){
    await client.query('DELETE FROM dealer_locations WHERE dealer_id=$1 AND postcode IS DISTINCT FROM $2',[dealerId,postcode]);return;
  }
  await client.query('INSERT INTO dealer_locations(dealer_id,postcode,latitude,longitude,region,administrative_area,verified_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(dealer_id) DO UPDATE SET postcode=excluded.postcode,latitude=excluded.latitude,longitude=excluded.longitude,region=excluded.region,administrative_area=excluded.administrative_area,verified_at=excluded.verified_at',[dealerId,postcode,verified.latitude,verified.longitude,verified.region,verified.administrativeArea]);
}
