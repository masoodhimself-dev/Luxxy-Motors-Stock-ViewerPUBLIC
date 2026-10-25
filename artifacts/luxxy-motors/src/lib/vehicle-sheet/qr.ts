import qrcode from './vendor/qrcode.mjs';
import { stringToBytes } from './vendor/qrcode_UTF8.mjs';
import type { QrCode } from './types';
export function createVehicleQr(exactUrl: string): QrCode {
  qrcode.stringToBytes=stringToBytes;
  const qr=qrcode(0,'M');qr.addData(exactUrl,'Byte');qr.make();
  const modules=qr.getModuleCount(),outer=modules+8;let path='';
  for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(qr.isDark(y,x))path+=`M${x+4} ${y+4}h1v1h-1z`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outer} ${outer}" role="img" aria-label="Open this vehicle's public page" shape-rendering="crispEdges"><rect width="${outer}" height="${outer}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return {svg,sizeMm:Math.max(34,outer*.4),modules,quietZone:4,payload:exactUrl};
}
