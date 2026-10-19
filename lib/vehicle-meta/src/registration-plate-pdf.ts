import type { jsPDF } from 'jspdf';
import { registrationPlateFontBase64 } from './registration-plate-font.ts';
import { formatRegistrationPlate } from './registration.ts';

export const registrationPdfFontName = 'ForecourtPlateUK';
export function registerRegistrationPdfFont(pdf: jsPDF) {
  if (!pdf.getFontList()[registrationPdfFontName]) {
    pdf.addFileToVFS('ForecourtPlateUK.ttf', registrationPlateFontBase64);
    pdf.addFont('ForecourtPlateUK.ttf', registrationPdfFontName, 'normal');
  }
}

/** Vector border and embedded, selectable lettering. White face, no flag/UK badge. */
export function drawInvoiceRegistrationPlate(pdf: jsPDF, value: string, x: number, top: number, width = 38, height = 8.8): boolean {
  const registration = formatRegistrationPlate(value);
  if (!registration) return false;
  registerRegistrationPdfFont(pdf);
  pdf.saveGraphicsState();
  pdf.setDrawColor(54,54,54); pdf.setFillColor(255,255,255); pdf.setLineWidth(.2);
  pdf.roundedRect(x,top,width,height,.6,.6,'FD');
  pdf.setFont(registrationPdfFontName,'normal'); pdf.setFontSize(17); pdf.setTextColor(0,0,0);
  const size = Math.min(17,17*(width-4)/Math.max(width-4,pdf.getTextWidth(registration)));
  pdf.setFontSize(size);
  // Supplied font capitals are 790/1000 em tall; centre the visible glyphs.
  pdf.text(registration,x+width/2,top+height/2+size*25.4/72*.395,{align:'center'});
  pdf.restoreGraphicsState();
  return true;
}
