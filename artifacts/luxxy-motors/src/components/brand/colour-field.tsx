import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

export function isValidHsl(value: string) {
  const match = value.trim().replace(/,/g, ' ').match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  return Boolean(match && Number(match[1]) <= 360 && Number(match[2]) <= 100 && Number(match[3]) <= 100);
}

export function hslToHex(value: string) {
  if (!isValidHsl(value)) return '#000000';
  const [h, s, l] = value.match(/[\d.]+/g)!.map(Number);
  const lightness = l / 100;
  const a = s / 100 * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function hexToHsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min, lightness = (max + min) / 2;
  let hue = 0;
  if (delta) {
    hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue *= 60;
  }
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return `${Number(hue.toFixed(2))} ${Number((saturation * 100).toFixed(2))}% ${Number((lightness * 100).toFixed(2))}%`;
}

export function ColourField({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  const [hex, setHex] = useState(hslToHex(value));
  useEffect(() => setHex(hslToHex(value)), [value]);
  const validHex = /^#[a-f\d]{6}$/i.test(hex);
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-[13px] font-semibold">{label}</legend>
      <div className="flex gap-2">
        <input type="color" aria-label={`Choose ${label.toLowerCase()}`} value={hslToHex(value)} onChange={(event) => onChange(hexToHsl(event.target.value))} className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1" />
        <Input aria-label={`${label} hex code`} value={hex} maxLength={7} pattern="#[a-fA-F0-9]{6}" required aria-invalid={!validHex} aria-describedby={!validHex ? `${testId}-error` : undefined} onChange={(event) => {
          const next = event.target.value;
          setHex(next);
          if (/^#[a-f\d]{6}$/i.test(next)) onChange(hexToHsl(next));
        }} className="min-w-0 font-mono" data-testid={`${testId}-hex`} />
      </div>
      {!validHex && <p id={`${testId}-error`} className="text-xs text-destructive">Use # followed by six letters or numbers, such as #20302a.</p>}
      <details className="text-xs text-muted-foreground">
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">Advanced HSL value</summary>
        <Input aria-label={`${label} HSL`} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} className="font-mono" />
      </details>
    </fieldset>
  );
}
