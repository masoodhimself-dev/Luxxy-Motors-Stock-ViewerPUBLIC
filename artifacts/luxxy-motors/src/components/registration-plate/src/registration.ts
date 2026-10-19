/** Reuse the host application's formatter; this package has no format rules. */
export type RegistrationFormatter = (registration: string) => string;

export function resolveRegistration(
  registration: string | null | undefined,
  formatter?: RegistrationFormatter,
): string | null {
  // Do not let an empty vehicle record become a fabricated registration.
  if (registration == null || registration.trim() === '') return null;
  const value = formatter ? formatter(registration) : registration;
  return value.trim() === '' ? null : value;
}

export function registrationFit(value: string): number {
  const characters = Array.from(value);
  const advance = characters.reduce(
    (sum, character) => sum + (/\s/u.test(character) ? 220 : /[I1i]/.test(character) ? 250 : 610),
    0,
  );
  // Use font size only: never stretch letterforms. The length guard also keeps
  // the temporary monospace fallback inside the face during font-display: swap.
  return Math.min(1, 4490 / advance, 8 / characters.length);
}
