import { clearDemoActivity, seedDemo } from './demo-workspace';
import type { SaleWorkspaceReadClient } from './sale-workspace-store';
/** Caller holds the demo row and dealer-specific import/sales/settings locks. */
export async function saveDemoBaseline(client:SaleWorkspaceReadClient,id:string,config:unknown,logoData:string|null){
 const vehicles=(await client.query('SELECT * FROM vehicles WHERE dealer_id=$1',[id])).rows;
 if(!vehicles.length)return false;
 const images=(await client.query('SELECT i.* FROM vehicle_images i JOIN vehicles v ON v.id=i.vehicle_id WHERE v.dealer_id=$1',[id])).rows;
 await clearDemoActivity(client,id);await seedDemo(client,id,config);
 await client.query('UPDATE dealer_demos SET baseline=$2::jsonb WHERE dealer_id=$1',[id,JSON.stringify({version:1,config,logoData,vehicles:vehicles.map(v=>({...v,inventory_status:'available'})),images,savedAt:new Date().toISOString()})]);
 return true;
}
