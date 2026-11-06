import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetDealerSettingsQueryKey } from '@workspace/api-client-react';
import { VehicleQuickChecks } from '../src/components/vehicle-quick-checks';
import { previewSettings } from './settings';

/** A local test page using the real components and isolated, read-only fixtures. */
export default function CustomerChecksPage() {
  const [client]=useState(()=>{
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,refetchOnWindowFocus:false}}});
    cache.setQueryData(getGetDealerSettingsQueryKey(),{...previewSettings,
      identity:{...previewSettings.identity,name:'Multi-Choice Motors'},
      address:{street:'36a Coldharbour Lane',city:'Hayes',region:'London',postcode:'UB3 3EP',mapsUrl:''},
      delivery:{...previewSettings.delivery,enabled:true},deliveryPricing:{enabled:true,basePrice:'50',pricePerMile:'2'},
    });
    cache.setQueryData(['dealer-features'],{features:{testDriveBookings:true,testDriveDeclarations:true,customerEmails:true,publicEnquiries:true,partExchange:true},evaluatedAt:new Date().toISOString()});
    return cache;
  });
  const [message,setMessage]=useState('');
  return <QueryClientProvider client={client}>
    <main style={{maxWidth:1040,margin:'48px auto',padding:'0 24px',color:'#192a36'}}>
      <h1 style={{fontSize:30,fontWeight:700,marginBottom:12}}>Vehicle checks</h1>
      <p style={{fontSize:14,maxWidth:640,lineHeight:1.6,marginBottom:24}}>Local design test. MOT mileage comes from the supplied Vauxhall screenshot. Delivery uses an example quote for SW1A 1AA; no route lookup, booking or message is sent.</p>
      <VehicleQuickChecks vehicleId="design-mot-history" vehiclePrice={2750} currency="GBP" onEnquire={setMessage}>
        {({motAction,deliveryAction})=><div style={{display:'flex',gap:16,flexWrap:'wrap'}}>{motAction}{deliveryAction}</div>}
      </VehicleQuickChecks>
      {message&&<p role="status" style={{whiteSpace:'pre-wrap',marginTop:24}}>Enquiry preview: {message}</p>}
    </main>
  </QueryClientProvider>;
}
