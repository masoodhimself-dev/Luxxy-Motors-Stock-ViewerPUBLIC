import { embeddedCss } from './generated-assets';
export function installVehicleSheetStyles(doc:Document):void {if(doc.querySelector('style[data-luxxy-vehicle-sheet]'))return;const style=doc.createElement('style');style.dataset.luxxyVehicleSheet='1';style.textContent=embeddedCss;doc.head.appendChild(style);}
