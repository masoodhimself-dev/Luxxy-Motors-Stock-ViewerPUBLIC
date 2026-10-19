/** Direction 01, millimetres unless a name ends in Pt. */
export const LAYOUT = {
  pageWidth: 210, pageHeight: 297,
  left: 14, right: 196, width: 182,
  footerRuleY: 274.5, contentLimit: 271.5,
  bodyPt: 9.2, smallPt: 8.5, headingPt: 8.5,
  lineAdvance: 4, paymentRowMin: 5.1, saleRowMin: 5.1,
  paymentColumns: [24, 87, 42, 29] as const,
  saleColumns: [153, 29] as const,
  photoWidth: 32, photoHeight: 22,
  plateWidth: 34, plateRatio: 4.3,
  qrSize: 22, qrQuietModules: 4, qrMinModule: 0.35,
} as const;

export const APPROVED_COLOURS = {
  ink: '#172436', accent: '#826234', muted: '#617087', rule: '#D6DEE8',
} as const;
