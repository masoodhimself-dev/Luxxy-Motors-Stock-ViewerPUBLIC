import { useState } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import type { Car } from '@/lib/stock-context';
import { getThumbnailUrl,vehicleDisplayTitle,vehicleRegistration } from '@/lib/utils';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';

export function saleVehicleChoiceLabel(car:Car){
 const registration=vehicleRegistration(car)||car.registration||car.registrationBand;
 return [...new Set([
  car.year,vehicleDisplayTitle(car),car.variant,registration,car.colour,
  typeof car.mileage==='number'?`${car.mileage.toLocaleString('en-GB')} miles`:car.mileageText,
  car.fuel,car.transmission,
  typeof car.price==='number'?new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(car.price):null,
  car.inventoryStatus==='reserved'?'Reserved':null,
 ].filter(Boolean))].join(' · ');
}

/** Portalled preview avoids clipping in the invoice form; click/tap opens an accessible dialog. */
export function SaleVehiclePhoto({car}:{car:Car}){
 const [expanded,setExpanded]=useState(false),[failed,setFailed]=useState('');
 const src=getThumbnailUrl(car),title=vehicleDisplayTitle(car);
 if(!src||failed===src)return null;
 const details=[car.year,car.colour,vehicleRegistration(car)].filter(Boolean).join(' · ');
 return <>
  <HoverCard.Root openDelay={180} closeDelay={120}>
   <HoverCard.Trigger asChild>
    <button type="button" className="invoice-car-photo" aria-label={`Enlarge photo of ${title}`} onClick={()=>setExpanded(true)}>
     <img src={src} alt={title} onError={()=>setFailed(src)}/><span>View photo</span>
    </button>
   </HoverCard.Trigger>
   <HoverCard.Portal><HoverCard.Content side="right" align="start" sideOffset={12} collisionPadding={16} className="invoice-car-photo-preview">
    <img src={src} alt={`Larger photo of ${title}`}/><p><strong>{title}</strong>{details&&<span>{details}</span>}</p>
   </HoverCard.Content></HoverCard.Portal>
  </HoverCard.Root>
  <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="sm:max-w-3xl">
   <DialogTitle className="pr-12">{title}</DialogTitle><DialogDescription>{details||'Vehicle photograph'}</DialogDescription>
   <img src={src} alt={`Enlarged photo of ${title}`} className="max-h-[65dvh] w-full rounded-md object-contain"/>
  </DialogContent></Dialog>
 </>;
}
