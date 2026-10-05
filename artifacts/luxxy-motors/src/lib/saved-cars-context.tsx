import type { Car } from './stock-context';
import { rememberSavedCar, forgetSavedSnapshots } from './saved-car-snapshots';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const SAVED_KEY = 'luxxy.saved-cars.v1';
const COMPARE_KEY = 'luxxy.compare-cars.v1';

/** Customers compare two cars side by side, the way they would on the forecourt. */
export const MAX_COMPARE = 2;

export type CompareResult = 'added' | 'removed' | 'full';

interface SavedCarsContextValue {
  savedIds: string[];
  compareIds: string[];
  savedCount: number;
  compareCount: number;
  isSaved: (id: string) => boolean;
  isComparing: (id: string) => boolean;
  /** Returns the saved state after the toggle. */
  toggleSaved: (id: string, car?: Car) => boolean;
  toggleCompare: (id: string) => CompareResult;
  removeFromCompare: (id: string) => void;
  clearCompare: () => void;
  /** Drops compared cars that are no longer in stock so they stop holding a slot. */
  pruneCompare: (availableIds: string[]) => void;
  /** Removes the given ids, or every saved car when called with no argument. */
  clearSaved: (ids?: string[]) => void;
}

const SavedCarsContext = createContext<SavedCarsContextValue | undefined>(undefined);

function readIds(key: string, limit?: number): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const ids = Array.from(
      new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)),
    );
    return typeof limit === 'number' ? ids.slice(0, limit) : ids;
  } catch {
    // A corrupt or unreadable store should never stop the showroom rendering.
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Private browsing and full quotas make writes fail; the in-memory list still works.
  }
}

export function SavedCarsProvider({ children }: { children: ReactNode }) {
  const [savedIds, setSavedIds] = useState<string[]>(() => readIds(SAVED_KEY));
  const [compareIds, setCompareIds] = useState<string[]>(() => readIds(COMPARE_KEY, MAX_COMPARE));

  useEffect(() => {
    writeIds(SAVED_KEY, savedIds);
  }, [savedIds]);

  useEffect(() => {
    writeIds(COMPARE_KEY, compareIds);
  }, [compareIds]);

  // Keep a second tab honest: comparing cars across two windows is a normal way to shop.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SAVED_KEY) setSavedIds(readIds(SAVED_KEY));
      if (event.key === COMPARE_KEY) setCompareIds(readIds(COMPARE_KEY, MAX_COMPARE));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Toggling reports its outcome straight back to the caller (the buttons turn it into a toast),
  // so reads have to see the newest list even when several clicks land before React re-renders.
  // These refs hold that list; state and storage follow from them.
  const savedRef = useRef(savedIds);
  const compareRef = useRef(compareIds);

  useEffect(() => {
    savedRef.current = savedIds;
  }, [savedIds]);

  useEffect(() => {
    compareRef.current = compareIds;
  }, [compareIds]);

  const commitSaved = useCallback((next: string[]) => {
    savedRef.current = next;
    setSavedIds(next);
  }, []);

  const commitCompare = useCallback((next: string[]) => {
    compareRef.current = next;
    setCompareIds(next);
  }, []);

  const toggleSaved = useCallback(
    (id: string, car?: Car) => {
      const current = savedRef.current;
      const nextSaved = !current.includes(id);
      if (nextSaved && car) rememberSavedCar(car);
      if (!nextSaved) forgetSavedSnapshots([id]);
      commitSaved(nextSaved ? [id, ...current] : current.filter((savedId) => savedId !== id));
      return nextSaved;
    },
    [commitSaved],
  );

  const toggleCompare = useCallback(
    (id: string): CompareResult => {
      const current = compareRef.current;

      if (current.includes(id)) {
        commitCompare(current.filter((compareId) => compareId !== id));
        return 'removed';
      }
      if (current.length >= MAX_COMPARE) return 'full';

      commitCompare([...current, id]);
      return 'added';
    },
    [commitCompare],
  );

  const removeFromCompare = useCallback(
    (id: string) => {
      commitCompare(compareRef.current.filter((compareId) => compareId !== id));
    },
    [commitCompare],
  );

  const clearCompare = useCallback(() => commitCompare([]), [commitCompare]);

  const pruneCompare = useCallback(
    (availableIds: string[]) => {
      const available = new Set(availableIds);
      const current = compareRef.current;
      const next = current.filter((id) => available.has(id));
      if (next.length !== current.length) commitCompare(next);
    },
    [commitCompare],
  );

  const clearSaved = useCallback(
    (ids?: string[]) => {
      forgetSavedSnapshots(ids);
      if (!ids) {
        commitSaved([]);
        return;
      }
      const removing = new Set(ids);
      commitSaved(savedRef.current.filter((savedId) => !removing.has(savedId)));
    },
    [commitSaved],
  );

  const value = useMemo<SavedCarsContextValue>(
    () => ({
      savedIds,
      compareIds,
      savedCount: savedIds.length,
      compareCount: compareIds.length,
      isSaved: (id: string) => savedIds.includes(id),
      isComparing: (id: string) => compareIds.includes(id),
      toggleSaved,
      toggleCompare,
      removeFromCompare,
      clearCompare,
      pruneCompare,
      clearSaved,
    }),
    [
      savedIds,
      compareIds,
      toggleSaved,
      toggleCompare,
      removeFromCompare,
      clearCompare,
      pruneCompare,
      clearSaved,
    ],
  );

  return <SavedCarsContext.Provider value={value}>{children}</SavedCarsContext.Provider>;
}

export function useSavedCars() {
  const context = useContext(SavedCarsContext);
  if (context === undefined) {
    throw new Error('useSavedCars must be used within a SavedCarsProvider');
  }
  return context;
}
