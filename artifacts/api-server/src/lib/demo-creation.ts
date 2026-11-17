import { applyDemoDealershipDetails,demoDealershipDetails,demoShowroomAddress,demoOpeningHours,publishedDemoHours } from './demo-business-details';
import { cazooDealershipLink } from '@workspace/vehicle-meta';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';
import type { db } from '@workspace/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { demoProvisioning } from './demo-policy';
import { isReservedDealerHost } from './tenant-context';
import { newDealerSettings } from '../routes/dealer-settings';
import type { SaleWorkspaceReadClient } from './sale-workspace-store';
export class DemoSetupError extends Error { constructor(message:string, readonly status=400){super(message);} }
export const demoCreationInput=z.object({slug:z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/), name:z.string().trim().min(1).max(100),platform:z.enum(['autotrader','cazoo']),retailerId:z.string().trim().min(1).max(128),sourceUrl:z.string().url(),recipient:z.string().email(),days:z.number().int().min(1).max(90).default(14),logoData:z.string().max(400000).optional(),footerLogoData:z.string().max(400000).optional(),showroomAddress:demoShowroomAddress.optional(),openingHours:demoOpeningHours.optional(),dealershipDetails:demoDealershipDetails.optional()}).strict();

export function validatedDemoInput(raw:unknown, privatePreview = false) {
 const schema = privatePreview ? demoCreationInput.extend({ recipient: z.email().optional() }) : demoCreationInput;
 const parsed=schema.safeParse(raw),p=demoProvisioning();
 if(!parsed.success)throw new DemoSetupError(privatePreview
   ? 'Enter a dealer name, unique demo name and authorised stock source.'
   : 'Enter a dealer name, unique demo name, authorised source and approved test email.');
  const d=parsed.data, id=`demo-${d.slug}`,host=`${d.slug}.${privatePreview ? 'demo.invalid' : p.domain}`, source=new URL(d.sourceUrl);
  const recipient = privatePreview ? '' : d.recipient?.toLowerCase() ?? '';
  if(!privatePreview && (!p.domain || !p.domainsReady)){throw new DemoSetupError('Demo domains are not ready. Complete wildcard DNS/TLS and Clerk setup first.',409);}
  if(!privatePreview && isReservedDealerHost(host)){throw new DemoSetupError('Choose a different demo hostname. This one is reserved.',409);}
  if(!privatePreview && !p.recipients.includes(recipient)){throw new DemoSetupError('Choose an operator-approved demo email recipient.');}
  const allowed=d.platform==='cazoo'?['cazoo.co.uk','www.cazoo.co.uk']:['autotrader.co.uk','www.autotrader.co.uk'];
  if(source.protocol!=='https:' || source.username || source.password || source.port || !allowed.includes(source.hostname)){throw new DemoSetupError('Stock source must be an authorised HTTPS URL from the selected marketplace.');}
  if (d.dealershipDetails) {
    const detailsSource = new URL(d.dealershipDetails.sourceUrl);
    const sameSource = detailsSource.hostname.replace(/^www\./, '') === source.hostname.replace(/^www\./, '') &&
      detailsSource.pathname.replace(/\/$/, '') === source.pathname.replace(/\/$/, '');
    const detailsRetailer = d.platform === 'cazoo' ? cazooDealershipLink(d.dealershipDetails.sourceUrl)?.retailerId : undefined;
    if (!sameSource || (d.platform === 'cazoo' && detailsRetailer !== `cazoo-${d.retailerId.replace(/^cazoo-/, '')}`)) {
      throw new DemoSetupError('The dealership details must come from the same dealership stock page.');
    }
  }
  if((d.logoData?.length??0)+(d.footerLogoData?.length??0)>400000)throw new DemoSetupError('Keep the combined encoded header and footer logos under 400,000 characters.');
  const readLogo=(value?:string):string|null=>{
  if(value){
    const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    const data=match?Buffer.from(match[2],'base64'):Buffer.alloc(0);
    if(!match || data.length>250000 || !(match[1]==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data[0]===255&&data[1]===216&&data[2]===255)){throw new DemoSetupError('Upload a PNG or JPEG logo smaller than 250 KB.');}return value;
  }return null;};
 const logo=readLogo(d.logoData),footerLogo=readLogo(d.footerLogoData);
 return {d,id,host,logo,footerLogo,p,privatePreview,recipient};
}
export const demoBrandingPatch=demoCreationInput.pick({logoData:true,footerLogoData:true,showroomAddress:true,openingHours:true}).partial().strict().refine(v=>Object.keys(v).length>0,'Supply at least one supported change.');
const demoDialect = new PgDialect();

export async function insertDemo(
  client: SaleWorkspaceReadClient | Pick<typeof db, 'execute'>,
  prepared: ReturnType<typeof validatedDemoInput>,
  ownerAuthUserId: string,
) {
  const execute = (statement: SQL) => {
    if ('execute' in client) return client.execute(statement);
    const query = demoDialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  };
  const { d, id, host, logo, footerLogo, p, privatePreview, recipient } = prepared;
  const origin = `https://${host}`;
  const config = {
    ...newDealerSettings(d.name),
    hours: d.openingHours ? publishedDemoHours(d.openingHours) : [],
    ...(footerLogo ? { presentation: { footerLogoUrl: `${origin}/api/demo-logo?variant=footer` } } : {}),
  };
  config.identity.logoAsset = logo ? '/api/demo-logo' : '';
  config.hero.announcement = '';
  if (d.showroomAddress) {
    const { sourceUrl, checkedAt, ...address } = d.showroomAddress;
    config.address = { ...address, mapsUrl: address.mapsUrl ?? '' };
  }
  config.contact.email = !privatePreview && p.emailDomain ? `${id}@${p.emailDomain}` : '';
  const businessDetails = {
    ...(d.showroomAddress ? { showroomAddress: d.showroomAddress } : {}),
    ...(d.openingHours ? { openingHours: d.openingHours } : {}),
    ...(d.dealershipDetails ? { dealershipDetails: d.dealershipDetails } : {}),
  };

  await execute(sql`
    INSERT INTO dealerships (id, name, status, canonical_origin, stock_platform, retailer_id, source_url)
    VALUES (${id}, ${d.name}, ${privatePreview ? 'draft' : 'active'}, ${origin}, ${d.platform}, ${d.retailerId}, ${d.sourceUrl})
  `);
  if (!privatePreview) {
    await execute(sql`
      INSERT INTO dealer_domains (hostname, dealer_id, verified, verification_token)
      VALUES (${host}, ${id}, true, ${`platform-owned-demo=${randomBytes(24).toString('hex')}`})
    `);
  }
  await execute(sql`INSERT INTO portal_users (dealer_id, auth_user_id, role) VALUES (${id}, ${ownerAuthUserId}, 'owner')`);
  await execute(sql`INSERT INTO dealer_settings (dealer_id, config) VALUES (${id}, ${JSON.stringify(applyDemoDealershipDetails(config, d.dealershipDetails))}::jsonb)`);
  await execute(sql`
    INSERT INTO dealer_demos (dealer_id, recipient, expires_at, updated_by, logo_data, footer_logo_data, business_details)
    VALUES (${id}, ${recipient}, ${new Date(Date.now() + d.days * 86400000).toISOString()}, ${ownerAuthUserId}, ${logo}, ${footerLogo}, ${JSON.stringify(businessDetails)}::jsonb)
  `);
  return { dealerId: id, origin };
}
