import { demoShowroomAddress,demoOpeningHours,publishedDemoHours } from './demo-business-details';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';
import { demoProvisioning } from './demo-policy';
import { seedDemo } from './demo-workspace';
import { newDealerSettings } from '../routes/dealer-settings';
import type { SaleWorkspaceReadClient } from './sale-workspace-store';
export class DemoSetupError extends Error { constructor(message:string, readonly status=400){super(message);} }
export const demoCreationInput=z.object({slug:z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/), name:z.string().trim().min(1).max(100),platform:z.enum(['autotrader','cazoo']),retailerId:z.string().trim().min(1).max(128),sourceUrl:z.string().url(),recipient:z.string().email(),days:z.number().int().min(1).max(90).default(14),logoData:z.string().max(400000).optional(),footerLogoData:z.string().max(400000).optional(),showroomAddress:demoShowroomAddress.optional(),openingHours:demoOpeningHours.optional()}).strict();

export function validatedDemoInput(raw:unknown) {
 const parsed=demoCreationInput.safeParse(raw),p=demoProvisioning();
 if(!parsed.success)throw new DemoSetupError('Enter a dealer name, unique demo name, authorised source and approved test email.');
  const d=parsed.data, id=`demo-${d.slug}`,host=`${d.slug}.${p.domain}`, source=new URL(d.sourceUrl);
  if(!p.domain || !p.domainsReady){throw new DemoSetupError('Demo domains are not ready. Complete wildcard DNS/TLS and Clerk setup first.',409);}
  if(!p.recipients.includes(d.recipient.toLowerCase())){throw new DemoSetupError('Choose an operator-approved demo email recipient.');}
  const allowed=d.platform==='cazoo'?['cazoo.co.uk','www.cazoo.co.uk']:['autotrader.co.uk','www.autotrader.co.uk'];
  if(source.protocol!=='https:' || source.username || source.password || source.port || !allowed.includes(source.hostname)){throw new DemoSetupError('Stock source must be an authorised HTTPS URL from the selected marketplace.');}
  if((d.logoData?.length??0)+(d.footerLogoData?.length??0)>400000)throw new DemoSetupError('Keep the combined encoded header and footer logos under 400,000 characters.');
  const readLogo=(value?:string):string|null=>{
  if(value){
    const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    const data=match?Buffer.from(match[2],'base64'):Buffer.alloc(0);
    if(!match || data.length>250000 || !(match[1]==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data[0]===255&&data[1]===216&&data[2]===255)){throw new DemoSetupError('Upload a PNG or JPEG logo smaller than 250 KB.');}return value;
  }return null;};
 const logo=readLogo(d.logoData),footerLogo=readLogo(d.footerLogoData);
 return {d,id,host,logo,footerLogo,p};
}
export async function insertDemo(client:SaleWorkspaceReadClient, prepared:ReturnType<typeof validatedDemoInput>, ownerAuthUserId:string){
 const {d,id,host,logo,footerLogo,p}=prepared;
    const config={...newDealerSettings(d.name),hours:d.openingHours?publishedDemoHours(d.openingHours):[],...(footerLogo?{presentation:{footerLogoUrl:`https://${host}/api/demo-logo?variant=footer`}}:{})};config.identity.logoAsset=logo?'/api/demo-logo':'';config.hero.announcement='';
    if(d.showroomAddress){const {sourceUrl,checkedAt,...address}=d.showroomAddress;config.address={...address,mapsUrl:address.mapsUrl??''};}
    config.contact.email=p.emailDomain?`${id}@${p.emailDomain}`:'';
    await client.query("INSERT INTO dealerships (id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES ($1,$2,'active',$3,$4,$5,$6)",[id,d.name,`https://${host}`,d.platform,d.retailerId,d.sourceUrl]);
    await client.query('INSERT INTO dealer_domains (hostname,dealer_id,verified,verification_token) VALUES ($1,$2,true,$3)',[host,id,`platform-owned-demo=${randomBytes(24).toString('hex')}`]);
    await client.query("INSERT INTO portal_users (dealer_id,auth_user_id,role) VALUES ($1,$2,'owner')",[id,ownerAuthUserId]);
    await client.query('INSERT INTO dealer_settings (dealer_id,config) VALUES ($1,$2::jsonb)',[id,JSON.stringify(config)]);
    await client.query('INSERT INTO dealer_demos (dealer_id,recipient,expires_at,updated_by,logo_data,footer_logo_data,business_details) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,d.recipient.toLowerCase(),new Date(Date.now()+d.days*86400000),ownerAuthUserId,logo,footerLogo,JSON.stringify({...(d.showroomAddress?{showroomAddress:d.showroomAddress}:{}),...(d.openingHours?{openingHours:d.openingHours}:{})})]);
    await seedDemo(client,id,config);

 return {dealerId:id,origin:`https://${host}`};
}
