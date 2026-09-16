import type { ReactNode } from 'react';
import { LeadSource } from '@workspace/api-client-react';
import { FieldLabel, SelectField, sourceLabels } from './portal-ui';

export const sourceOptions = Object.values(LeadSource);

/**
 * `datetime-local` speaks the browser's local clock, which for this dealership
 * is the same London clock the API reports in. Round-trip helpers keep the two
 * representations in step.
 */
export function toLocalInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Trims a text field down to `null` so blank inputs never store empty strings. */
export function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function poundsToPence(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed.replace(/[£,\s]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function penceToPounds(value: number | null | undefined) {
  if (!value) return '';
  return String(value / 100);
}

export function Field({
  label,
  children,
  className = '',
  hint,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <span className="block text-[12px] text-muted-foreground font-normal uppercase tracking-widest">{hint}</span>}
    </label>
  );
}

export function SourceSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  return (
    <SelectField
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-testid="select-source"
    >
      {sourceOptions.map((source) => (
        <option key={source} value={source}>
          {sourceLabels[source]}
        </option>
      ))}
    </SelectField>
  );
}
