import {roadDistanceService} from '../lib/road-distance-storage';
import {RoadDistanceError} from '../lib/road-distance';
import {parseDeliveryPricing,deliveryEstimate} from '../lib/delivery-pricing';
import { Router } from 'express';
import { currentDealerId } from '../lib/tenant-context';
import { PostcodeError, distanceMiles } from '../lib/postcodes';
import { postcodeService } from '../lib/postcode-storage';
import { pool } from '@workspace/db';
export function postcodeRouter(service=postcodeService,database:Pick<typeof pool,'query'>=pool, roads=roadDistanceService){
 const router=Router(),limits=new Map<string,{count:number;until:number}>();
 router.use('/postcodes', (req,res,next)=>{
  res.set('Cache-Control','no-store');
  const key=`${currentDealerId()}:${req.ip}`,now=Date.now();
  let limit=limits.get(key);
  if(!limit || limit.until<=now){if(limits.size>=5000)limits.delete(limits.keys().next().value!);limit={count:0,until:now+60000};limits.set(key,limit);}
  if(++limit.count>60){res.set('Retry-After',String(Math.ceil((limit.until-now)/1000)));res.status(429).json({error:'Too many postcode requests. Enter the address manually.'});return;}
  next();
 });
 router.get('/postcodes',async(req,res)=>{
  try {
   const postcode=req.query.postcode,query=req.query.query;
   if(typeof postcode==='string' && query===undefined && postcode.length<=20){res.json({location:await service.lookup(postcode)});return;}
   if(typeof query==='string' && postcode===undefined){res.json({postcodes:await service.autocomplete(query)});return;}
   res.status(400).json({error:'Supply a postcode or postcode prefix.'});
  }catch(error){if(error instanceof PostcodeError){res.status(error.status).json({error:error.message,code:error.code});return;}res.status(503).json({error:'Postcode lookup is unavailable. Enter the address manually.'});}
 });
 router.get('/postcodes/delivery-estimate',async(req,res)=>{
  try {
   if(typeof req.query.postcode!=='string'||req.query.postcode.length>20){res.status(400).json({error:'Enter your UK postcode.'});return;}
   const result=await database.query("SELECT s.config,l.latitude,l.longitude FROM dealer_settings s LEFT JOIN dealer_locations l ON l.dealer_id=s.dealer_id AND upper(regexp_replace(s.config #>> '{address,postcode}', '\\s', '', 'g'))=replace(l.postcode,' ','') WHERE s.dealer_id=$1",[currentDealerId()]);
   const dealer=result.rows[0],pricing=parseDeliveryPricing(dealer?.config?.deliveryPricing);
   if(!dealer?.config?.delivery?.enabled || !pricing?.enabled){res.status(404).json({code:'delivery_disabled',error:'Please contact the dealership to discuss delivery.'});return;}
   if(dealer.latitude===null || dealer.longitude===null || dealer.latitude===undefined || dealer.longitude===undefined){res.status(503).json({code:'dealer_location_unavailable',error:'Please contact the dealership for a delivery quote.'});return;}
   const location=await service.lookup(req.query.postcode);
   if(location.latitude===null || location.longitude===null){res.status(422).json({code:'no_route',error:'We could not locate a road route to this postcode. Please contact us.'});return;}
   const metres=await roads.metres({latitude:Number(dealer.latitude),longitude:Number(dealer.longitude)},{latitude:location.latitude,longitude:location.longitude});
   res.json({...deliveryEstimate(pricing,metres),postcode:location.postcode});
  }catch(error){if(error instanceof PostcodeError || error instanceof RoadDistanceError){res.status(error.status).json({code:error.code,error:error.message});return;}res.status(503).json({error:'Delivery estimates are unavailable. Please contact the dealership for a quote.'});}
 });
 router.get('/postcodes/distance',async(req,res)=>{
  try {
   if(typeof req.query.postcode!=='string' || req.query.postcode.length>20){res.status(400).json({error:'Supply a customer postcode.'});return;}
   const location=await service.lookup(req.query.postcode);
   // Join to current settings: never use a location for an old showroom postcode.
   const result=await database.query("SELECT l.latitude,l.longitude FROM dealer_locations l JOIN dealer_settings s ON s.dealer_id=l.dealer_id WHERE l.dealer_id=$1 AND upper(regexp_replace(s.config #>> '{address,postcode}', '\\s', '', 'g'))=replace(l.postcode,' ','')",[currentDealerId()]);
   const dealer=result.rows[0];
   if(req.query.basis==='road'){
    if(!dealer || dealer.latitude==null || dealer.longitude==null || location.latitude===null || location.longitude===null){res.status(503).json({error:'The dealership or customer postcode has no usable coordinates.'});return;}
    const metres=await roads.metres({latitude:Number(dealer.latitude),longitude:Number(dealer.longitude)},{latitude:location.latitude,longitude:location.longitude});
    res.json({miles:Math.round(metres/1609.344*10)/10,approximate:true,distanceBasis:'driving'});return;
   }
   res.json({miles:dealer && location.latitude!==null && location.longitude!==null?Math.round(distanceMiles(location as {latitude:number;longitude:number},{latitude:Number(dealer.latitude),longitude:Number(dealer.longitude)})*10)/10:null,approximate:true});
  }catch(error){if(error instanceof PostcodeError || error instanceof RoadDistanceError){res.status(error.status).json({error:error.message,code:error.code});return;}res.status(503).json({error:'Distance is unavailable. You can continue without it.'});}
 });
 return router;
}
export default postcodeRouter();
