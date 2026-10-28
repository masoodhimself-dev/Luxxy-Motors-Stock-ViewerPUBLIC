import {pool} from '@workspace/db';
import {createRoadDistanceService} from './road-distance';
let pruned=0;
export const roadDistanceService=createRoadDistanceService({apiKey:()=>process.env.OPENROUTESERVICE_API_KEY,cache:{
 async read(key){const result=await pool.query('SELECT metres FROM road_distance_cache WHERE route_key=$1 AND expires_at>now()',[key]);return result.rows[0]?Number(result.rows[0].metres):null;},
 async write(key,metres){await pool.query("INSERT INTO road_distance_cache(route_key,metres,expires_at) VALUES($1,$2,now()+interval '7 days') ON CONFLICT(route_key) DO UPDATE SET metres=excluded.metres,expires_at=excluded.expires_at",[key,metres]);if(Date.now()-pruned>3600000){pruned=Date.now();await pool.query('DELETE FROM road_distance_cache WHERE route_key IN (SELECT route_key FROM road_distance_cache WHERE expires_at<now() LIMIT 1000)');await pool.query("DELETE FROM road_routing_usage WHERE bucket NOT IN ('minute:' || floor(extract(epoch FROM now())/60)::text, 'day:' || to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'))");}},
},reserve:()=>reserveRoadRoutingBudget()});

export async function reserveRoadRoutingBudget(database:Pick<typeof pool,'query'>=pool){
 const result=await database.query(`WITH buckets AS (SELECT 'minute:' || floor(extract(epoch FROM now())/60)::text AS key,40 AS maximum UNION ALL SELECT 'day:' || to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),2000), claimed AS (
 INSERT INTO road_routing_usage(bucket,count) SELECT key,1 FROM buckets ORDER BY key
 ON CONFLICT(bucket) DO UPDATE SET count=road_routing_usage.count+1
 WHERE road_routing_usage.count<(SELECT maximum FROM buckets WHERE key=excluded.bucket)
 RETURNING bucket) SELECT count(*)::int AS claimed FROM claimed`);
 return result.rows[0]?.claimed===2;
}
