import { useEffect, useState } from 'react';

const STORAGE_KEY = 'luxxy-motors-shortlist';

function readShortlist(): string[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

export function useShortlist() {
  const [savedIds, setSavedIds] = useState<string[]>([]);

  useEffect(() => {
    setSavedIds(readShortlist());
  }, []);

  const update = (next: string[]) => {
    setSavedIds(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The shortlist remains available for this session if browser storage is unavailable.
    }
  };

  const toggle = (id: string) => {
    update(savedIds.includes(id) ? savedIds.filter(savedId => savedId !== id) : [...savedIds, id]);
  };

  return { savedIds, savedCount: savedIds.length, toggle };
}