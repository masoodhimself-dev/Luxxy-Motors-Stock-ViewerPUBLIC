/** A document palette derived from saved dealer branding; no changes to settings. */
export function invoicePalette(value?: string | null) {
  const accent = /^#[\da-f]{6}$/i.test(value ?? '') ? value!.toLowerCase() : '#215a7e';
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const hex = (values: number[]) => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (a: string, b: string, weight: number) => hex(rgb(a).map((v, i) => v * (1 - weight) + rgb(b)[i] * weight));
  const luminance = (colour: string) => rgb(colour).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const tint = mix(accent, '#ffffff', .92), soft = mix(accent, '#ffffff', .97);
  let strong = mix(accent, '#152936', .25);
  // The same tone is used for white lettering and small labels on pale panels.
  // Check every surface: bright brand colours can pass against white yet fail
  // when their lettering sits on the dealer-tinted vehicle or receipt panel.
  for (let i = 0; i < 12 && ['#ffffff', tint, soft].some(surface => contrast(strong, surface) < 4.5); i++) strong = mix(strong, '#152936', .2);
  return { accent, strong, tint, soft, ink: '#172b38', muted: '#526675', rule: '#d5e0e7' };
}
