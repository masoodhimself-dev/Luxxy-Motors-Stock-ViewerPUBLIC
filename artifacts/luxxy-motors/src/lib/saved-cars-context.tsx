import type { Car } from './stock-context';
import { rememberSavedCar, forgetSavedSnapshots } from './saved-car-snapshots';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
const SAVED_KEY = 'luxxy.saved-cars.v1';
interface SavedCarsContextValue {
  savedIds: string[]; savedCount: number; isSaved: (id: string) => boolean;
  toggleSaved: (id: string, car?: Car) => boolean; clearSaved: (ids?: string[]) => void;
}
const SavedCarsContext = createContext<SavedCarsContextValue | undefined>(undefined);
function readIds(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))] : [];
  } catch { return []; }
}
export function SavedCarsProvider({ children }: { children: ReactNode }) {
  const [savedIds, setSavedIds] = useState<string[]>(() => readIds());
  const savedRef = useRef(savedIds);
  const commit = useCallback((ids: string[]) => { savedRef.current = ids; setSavedIds(ids); }, []);
  useEffect(() => {
    try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds)); } catch { /* In-memory saving still works. */ }
  }, [savedIds]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SAVED_KEY || event.key === null) commit(readIds()); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, [commit]);
  const toggleSaved = useCallback((id: string, car?: Car) => {
    const saved = !savedRef.current.includes(id);
    if (saved && car) rememberSavedCar(car);
    if (!saved) forgetSavedSnapshots([id]);
    commit(saved ? [id, ...savedRef.current] : savedRef.current.filter(value => value !== id));
    return saved;
  }, [commit]);
  const clearSaved = useCallback((ids?: string[]) => {
    forgetSavedSnapshots(ids); const removing = new Set(ids);
    commit(ids ? savedRef.current.filter(id => !removing.has(id)) : []);
  }, [commit]);
  const value = useMemo(() => ({ savedIds, savedCount: savedIds.length, isSaved: (id: string) => savedIds.includes(id), toggleSaved, clearSaved }), [savedIds, toggleSaved, clearSaved]);
  return <SavedCarsContext.Provider value={value}>{children}</SavedCarsContext.Provider>;
}
export function useSavedCars() {
  const context = useContext(SavedCarsContext); if (!context) throw new Error('useSavedCars must be used within a SavedCarsProvider'); return context;
}
