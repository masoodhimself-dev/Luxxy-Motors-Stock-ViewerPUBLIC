import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MotHistory } from '@workspace/vehicle-meta';

// Local visual QA only. Mileage/date pairs were supplied in the user's screenshot.
// This is never used by the production API or a real stock vehicle.
const screenshotHistory: MotHistory = {
  registration:'FY14MYO', make:'VAUXHALL', model:'ZAFIRA', checkedAt:'2026-11-06T12:00:00Z', recall:'Yes',
  tests:[
    ['2026-08-31','134590'], ['2025-10-27','120144'], ['2024-10-21','103101'],
    ['2023-10-27','86087'], ['2022-10-20','71126'], ['2021-10-25','57248'], ['2020-11-20','48899'],
  ].map(([completedDate,mileage],index)=>({completedDate,result:'PASSED',mileage,mileageUnit:'MI',expiryDate:index===0?'2027-08-30':null,defects:[]})),
};

export function customerChecksPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/api/vehicles/design-mot-history/mot-history') {
    res.end(JSON.stringify({status:'available',history:screenshotHistory})); return true;
  }
  if (url.pathname === '/api/postcodes/delivery-estimate' && req.headers.referer?.includes('/__preview/vehicle-checks')) {
    const postcode=(url.searchParams.get('postcode')??'').replace(/\s/g,'').toUpperCase();
    if (postcode!=='SW1A1AA') { res.statusCode=400; res.end(JSON.stringify({code:'invalid',error:'Use SW1A 1AA for this local example.'})); return true; }
    res.end(JSON.stringify({postcode:'SW1A 1AA',roadMiles:18.4,basePricePence:5000,pricePerMilePence:200,mileageChargePence:3680,totalPence:8680,distanceBasis:'driving',estimated:true,currency:'GBP'})); return true;
  }
  return false;
}
