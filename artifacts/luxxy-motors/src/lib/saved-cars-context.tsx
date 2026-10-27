import { readCustomerStorage, writeCustomerStorage } from './customer-test-storage';
import type { Car } from './stock-context';
import { rememberSavedCar, forgetSavedSnapshots } from './saved-car-snapshots';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
const SAVED_KEY = 'luxxy.saved-cars.v1';
type PracticeShortlist = { savedIds:string[]; toggleSaved:(id:string,car?:Car)=>void; clearSaved:()=>void; removeSaved:(ids:string[])=>void };
interface SavedCarsContextValue {
  testSessionId?: string; savedIds: string[]; savedCount: number; isSaved: (id: string) => boolean;
  toggleSaved: (id: string, car?: Car) => boolean; clearSaved: (ids?: string[]) => void;
}
const SavedCarsContext = createContext<SavedCarsContextValue | undefined>(undefined);
function readIds(testSessionId?: string): string[] {
  try {
    const value: unknown = JSON.parse(readCustomerStorage(window.localStorage, SAVED_KEY, testSessionId ?? null) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))] : [];
  } catch { return []; }
}
export function SavedCarsProvider({ children, testSessionId, practiceShortlist }: { children: ReactNode; testSessionId?: string; practiceShortlist?:PracticeShortlist }) {
  if (testSessionId && practiceShortlist) return <PracticeSavedCarsProvider testSessionId={testSessionId} shortlist={practiceShortlist}>{children}</PracticeSavedCarsProvider>;
  return <SavedCarsProviderImpl testSessionId={testSessionId}>{children}</SavedCarsProviderImpl>;
}
function PracticeSavedCarsProvider({children,testSessionId,shortlist}:{children:ReactNode;testSessionId:string;shortlist:PracticeShortlist}) {
  const value = useMemo<SavedCarsContextValue>(() => ({
    testSessionId, savedIds:shortlist.savedIds, savedCount:shortlist.savedIds.length, isSaved:id=>shortlist.savedIds.includes(id),
    toggleSaved:(id,car)=>{const next=!shortlist.savedIds.includes(id);shortlist.toggleSaved(id,car);return next;},
    clearSaved:(ids)=>{if(ids)shortlist.removeSaved(ids);else shortlist.clearSaved();},
  }),[testSessionId,shortlist]);
  return <SavedCarsContext.Provider value={value}>{children}</SavedCarsContext.Provider>;
}
function SavedCarsProviderImpl({ children, testSessionId }: { children: ReactNode; testSessionId?: string }) {
  const [savedIds, setSavedIds] = useState<string[]>(() => readIds(testSessionId));
  const savedRef = useRef(savedIds);
  const commit = useCallback((ids: string[]) => { savedRef.current = ids; setSavedIds(ids); }, []);
  useEffect(() => {
    try { writeCustomerStorage(window.localStorage, SAVED_KEY, JSON.stringify(savedIds), testSessionId ?? null); } catch { /* In-memory saving still works. */ }
  }, [savedIds, testSessionId]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (!testSessionId && (event.key === SAVED_KEY || event.key === null)) commit(readIds()); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, [commit, testSessionId]);
  const toggleSaved = useCallback((id: string, car?: Car) => {
    const saved = !savedRef.current.includes(id);
    if (saved && car) rememberSavedCar(car, testSessionId ?? null);
    if (!saved) forgetSavedSnapshots([id], testSessionId ?? null);
    commit(saved ? [id, ...savedRef.current] : savedRef.current.filter(value => value !== id));
    return saved;
  }, [commit, testSessionId]);
  const clearSaved = useCallback((ids?: string[]) => {
    forgetSavedSnapshots(ids, testSessionId ?? null); const removing = new Set(ids);
    commit(ids ? savedRef.current.filter(id => !removing.has(id)) : []);
  }, [commit, testSessionId]);
  const value = useMemo(() => ({ testSessionId, savedIds, savedCount: savedIds.length, isSaved: (id: string) => savedIds.includes(id), toggleSaved, clearSaved }), [testSessionId, savedIds, toggleSaved, clearSaved]);
  return <SavedCarsContext.Provider value={value}>{children}</SavedCarsContext.Provider>;
}
export function useSavedCars() {
  const context = useContext(SavedCarsContext); if (!context) throw new Error('useSavedCars must be used within a SavedCarsProvider'); return context;
}
