import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, engine, pool, dealershipsTable, vehiclesTable } from "./test/tenant-test-db";
import { recordPublishedStockPrice } from "./lib/stock-change-tasks";
import { recordVehicleWatchPriceChange, vehicleWatchEventIsCurrent, vehicleWatchRecipientHasCommitment } from "./lib/vehicle-watch-events";

test("watch events observe fictional price and availability changes without sending or changing sales", async t => {
  for (const file of (await readdir("../../lib/db/drizzle")).filter(file => /^\d.*\.sql$/.test(file)).sort())
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  const dealer="fictional-watch-events", other="fictional-watch-events-other";
  for (const id of [dealer,other]) await db.insert(dealershipsTable).values({id,name:"Fictional watch dealer",status:"active",stockPlatform:"autotrader",canonicalOrigin:`https://${id}.example.test`,retailerId:"fictional",sourceUrl:"https://www.autotrader.co.uk/cars/retailer/stock?retailerId=fictional"});
  const seed = async (extra: Record<string,any>={}) => (await db.insert(vehiclesTable).values({dealerId:dealer,source:"autotrader",advertId:randomUUID(),sourcePrice:10000,...extra}).returning())[0]!;
  const watch = async (vehicleId:string,status="active", verified:Date|null=new Date(Date.now()-60_000), dealerId=dealer,email=`${randomUUID()}@example.test`) => {
    const id=randomUUID();
    await pool.query("INSERT INTO vehicle_watches(id,dealer_id,vehicle_id,email,status,email_verified_at) VALUES($1,$2,$3,$4,$5,$6)",[id,dealerId,vehicleId,email,status,verified]);
    return id;
  };
  const events = async (vehicleId:string) => (await pool.query("SELECT * FROM vehicle_watch_events WHERE vehicle_id=$1 ORDER BY created_at,id",[vehicleId])).rows;
  const status = async (vehicleId:string,value:string,extra="") => pool.query(`UPDATE vehicles SET inventory_status=$2::inventory_status${extra} WHERE id=$1`,[vehicleId,value]);
  const current = async (id:string) => (await db.select().from(vehiclesTable).where(eq(vehiclesTable.id,id)))[0]!;
  const changePrice = async (id:string,value:number,currency="GBP",key=randomUUID()) => {
    const before=await current(id);
    const [after]=await db.update(vehiclesTable).set({sourcePrice:value,currency}).where(eq(vehiclesTable.id,id)).returning();
    await recordPublishedStockPrice(db as unknown as Parameters<typeof recordPublishedStockPrice>[0],before,after!,key,new Date(),2,undefined,"autotrader");
    return {before,after:after!,key};
  };
  try {
    await t.test("new, pending, stopped and unverified watchers never receive a historical baseline",async()=>{
      const car=await seed();
      await changePrice(car.id,9500);
      assert.equal((await events(car.id)).length,0);
      await watch(car.id,"pending",null); await watch(car.id,"stopped"); await watch(car.id,"active",null);
      await changePrice(car.id,9000); assert.equal((await events(car.id)).length,0);
      await watch(car.id); assert.equal((await events(car.id)).length,0);
      await changePrice(car.id,8500);
      const [event]=await events(car.id);assert.equal(event.kind,"price_drop");assert.equal(event.previous_price,9000);assert.equal(event.current_price,8500);
    });
    await t.test("the actual published-price hook emits one durable candidate, coalesces later drops and deduplicates retries",async()=>{
      const car=await seed();await watch(car.id);
      const changed=await changePrice(car.id,9000);
      await recordVehicleWatchPriceChange(db,changed.before,changed.after,changed.key,new Date(),{activePlatform:"autotrader"});
      assert.equal((await events(car.id)).length,1);
      await changePrice(car.id,8000);
      let result=await events(car.id);assert.equal(result.length,2);assert.equal(result.filter(e=>e.status==="open").length,1);assert.equal(result.find(e=>e.current_price===9000)!.status,"superseded");
      await changePrice(car.id,8500);result=await events(car.id);assert.equal(result.filter(e=>e.status==="open").length,0);
    });
    await t.test("overrides, unpublished prices, currencies and reserved stock cannot manufacture price offers",async()=>{
      const override=await seed({websitePriceOverride:12000});await watch(override.id);await changePrice(override.id,9000);assert.equal((await events(override.id)).length,0);
      const car=await seed();await watch(car.id);await changePrice(car.id,9000);await changePrice(car.id,9000,"EUR");assert.equal((await events(car.id)).filter(e=>e.status==="open").length,0);
      for(const extra of [{inventoryStatus:"reserved"},{sourceStatus:"missing"},{archivedAt:new Date()},{source:"cazoo"},{missingCount:2}]){
        const unavailable=await seed(extra);await watch(unavailable.id);await changePrice(unavailable.id,9000);assert.equal((await events(unavailable.id)).filter(e=>e.kind==="price_drop").length,0);
      }
    });
    await t.test("verified watchers on both marketplaces receive genuine public reductions",async()=>{
      await pool.query("UPDATE dealerships SET stock_platform='cazoo' WHERE id=$1",[other]);
      const car=await seed({dealerId:other,source:"cazoo"});await watch(car.id,"active",new Date(Date.now()-1000),other);
      const [after]=await db.update(vehiclesTable).set({sourcePrice:9500}).where(eq(vehiclesTable.id,car.id)).returning();
      await recordPublishedStockPrice(db as unknown as Parameters<typeof recordPublishedStockPrice>[0],car,after!,randomUUID(),new Date(),2,undefined,"cazoo");assert.equal((await events(car.id))[0].kind,"price_drop");
    });
    await t.test("existing reservation, release and sale writes create only the latest staff-review event",async()=>{
      const car=await seed();await watch(car.id);
      await status(car.id,"reserved");await status(car.id,"reserved");
      assert.deepEqual((await events(car.id)).map(e=>e.kind),["reserved"]);
      await status(car.id,"available");await status(car.id,"sold");
      const result=await events(car.id);assert.equal(result.length,3);assert.equal(result.filter(e=>e.status==="open").length,1);assert.equal(result.find(e=>e.status==="open")!.kind,"sold");
      assert.deepEqual(result.map(e=>e.current_status),["reserved","available","sold"]);
    });
    await t.test("price and currency edits invalidate a previously reviewed availability message",async()=>{
      const car=await seed();await watch(car.id);await status(car.id,"reserved");
      const initial=(await events(car.id))[0];assert.equal(initial.revision,0);
      await changePrice(car.id,9500);
      let result=await events(car.id);assert.equal(result.length,1);assert.equal(result[0].kind,"reserved");assert.equal(result[0].current_price,9500);assert.equal(result[0].revision,1);
      await changePrice(car.id,9500,"EUR");result=await events(car.id);assert.equal(result[0].revision,2);
    });
    await t.test("feed absence never creates sold or available-again, even when a reserved vehicle is released",async()=>{
      const car=await seed();await watch(car.id);await status(car.id,"reserved");
      await pool.query("UPDATE vehicles SET source_status='missing',missing_count=2 WHERE id=$1",[car.id]);
      assert.equal((await events(car.id)).length,1);
      await status(car.id,"available");const result=await events(car.id);assert.equal(result.length,1);assert.equal(result[0].status,"superseded");
      await pool.query("UPDATE vehicles SET source_status='live',missing_count=0 WHERE id=$1",[car.id]);assert.equal((await events(car.id)).length,1);
    });
    await t.test("unverified, future-verification, disabled and cross-platform watches cannot create status tasks",async()=>{
      for(const extra of [{source:"cazoo"},{archivedAt:new Date()},{sourceStatus:"missing"},{missingCount:1}]){
        const car=await seed(extra);await watch(car.id);await status(car.id,"reserved");assert.equal((await events(car.id)).length,0);
      }
      const future=await seed();await watch(future.id,"active",new Date(Date.now()+60_000));await status(future.id,"reserved");assert.equal((await events(future.id)).length,0);
      const noWatch=await seed();await watch(noWatch.id,"pending",null);await status(noWatch.id,"reserved");assert.equal((await events(noWatch.id)).length,0);
      await pool.query("INSERT INTO vehicle_watch_settings(dealer_id,enabled) VALUES($1,false)",[dealer]);
      const disabled=await seed();await watch(disabled.id);await status(disabled.id,"reserved");assert.equal((await events(disabled.id)).length,0);
      await pool.query("DELETE FROM vehicle_watch_settings WHERE dealer_id=$1",[dealer]);
    });
    await t.test("freshness validation rejects wrong price, currency, source, missing stock and outdated status",async()=>{
      const vehicle=await seed();const options={activePlatform:"autotrader"};
      const event={kind:"price_drop" as const,status:"open",currentPrice:10000,currentStatus:"available"};
      assert.equal(vehicleWatchEventIsCurrent(event,vehicle,options),true);
      for(const extra of [{sourcePrice:9999},{currency:"EUR"},{sourceStatus:"missing" as const},{inventoryStatus:"reserved" as const},{archivedAt:new Date()},{missingCount:2},{source:"cazoo"}]) assert.equal(vehicleWatchEventIsCurrent(event,{...vehicle,...extra},options),false);
      assert.equal(vehicleWatchEventIsCurrent({...event,status:"dismissed"},vehicle,options),false);
      for(const [kind,inventoryStatus] of [["reserved","reserved"],["available_again","available"],["sold","sold"]] as const){
        assert.equal(vehicleWatchEventIsCurrent({kind,status:"open",currentPrice:10000,currentStatus:inventoryStatus},{...vehicle,inventoryStatus},options),true);
        assert.equal(vehicleWatchEventIsCurrent({kind,status:"open",currentPrice:10000,currentStatus:inventoryStatus},{...vehicle,inventoryStatus:"hidden"},options),false);
      }
    });
    await t.test("existing buyer identities are protected across workspace, leads, linked enquiries and legacy sales",async()=>{
      const car=await seed(),another=await seed(),email="buyer@example.test",phone="07700 900123";
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),false);
      const workspace=randomUUID();await pool.query("INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,'FICTIONAL',0,$3::jsonb)",[workspace,dealer,JSON.stringify({draft:{vehicleId:car.id,email:"BUYER@example.test",phone},lifecycle:{status:"reserved"}})]);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),true);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,"other@example.test","+44 7700 900123"),true);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,another.id,email),false);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,other,car.id,email),false);
      await pool.query("UPDATE sale_workspace SET state=jsonb_set(state,'{lifecycle,status}','\"released\"') WHERE id=$1",[workspace]);assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),false);
      const enquiry=randomUUID();await pool.query("INSERT INTO enquiries(id,dealer_id,vehicle_id,type,customer_name,email,phone,message) VALUES($1,$2,$3,'general','Fictional buyer',$4,$5,'Fictional only')",[enquiry,dealer,car.id,email,phone]);
      await pool.query("UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1",[workspace,JSON.stringify({draft:{vehicleId:car.id,email:"different@example.test",phone:"+44 7700 900123"},lifecycle:{status:"reserved"}})]);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),true,"watch email resolves an existing enquiry's phone to the buyer");
      await pool.query("DELETE FROM sale_workspace WHERE id=$1",[workspace]);
      const lead=randomUUID();await pool.query("INSERT INTO leads(id,dealer_id,vehicle_id,enquiry_id,customer_name,stage,source,deposit_pence) VALUES($1,$2,$3,$4,'Fictional buyer','reserved','website_form',0)",[lead,dealer,car.id,enquiry]);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),true);
      await pool.query("UPDATE leads SET stage='lost',outcome='lost',outcome_reason='Fictional cancelled reservation',closed_at=now() WHERE id=$1",[lead]);assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),false);
      const customer=randomUUID();await pool.query("INSERT INTO customers(id,dealer_id,name,email,phone) VALUES($1,$2,'Fictional buyer',$3,$4)",[customer,dealer,email,phone]);
      const sale=randomUUID();await pool.query("INSERT INTO sales(id,dealer_id,vehicle_id,customer_id,agreed_price_pence,balance_pence,status) VALUES($1,$2,$3,$4,1000000,1000000,'signed')",[sale,dealer,car.id,customer]);
      assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),true);
      await pool.query("UPDATE sales SET status='cancelled' WHERE id=$1",[sale]);assert.equal(await vehicleWatchRecipientHasCommitment(pool.query,dealer,car.id,email),false);
    });
    await t.test("event detection leaves financial and message delivery records unchanged",async()=>{
      const before=(await pool.query("SELECT row_to_json(s) AS value FROM sales s ORDER BY id")).rows;
      const car=await seed();await watch(car.id);await changePrice(car.id,9000);await status(car.id,"reserved");await status(car.id,"sold");
      assert.deepEqual((await pool.query("SELECT row_to_json(s) AS value FROM sales s ORDER BY id")).rows,before);
      assert.equal((await pool.query("SELECT count(*)::int AS amount FROM vehicle_watch_deliveries")).rows[0].amount,0);
      assert.equal((await pool.query("SELECT count(*)::int AS amount FROM invoices")).rows[0].amount,0);
    });
  } finally { await engine.close(); }
});
