import { describe, expect, it } from 'vitest';
import { readableForegroundForHsl } from '@/components/layout';

describe('dealer brand colour contrast', () => {
  it('uses dark ink over the configured bright brass accent', () => {
    expect(readableForegroundForHsl('38 92% 50%')).toBe('0 0% 8%');
  });

  it('uses warm paper over the configured dark ink primary', () => {
    expect(readableForegroundForHsl('188 50% 14%')).toBe('0 0% 100%');
  });

  it('accepts comma-separated HSL values from dealer configuration', () => {
    expect(readableForegroundForHsl('45, 100%, 70%')).toBe('0 0% 8%');
  });
});