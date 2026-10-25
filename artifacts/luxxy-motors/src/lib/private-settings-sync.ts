import { useEffect, useRef } from 'react';

export type PrivateSettingsArea = 'sharing' | 'whatsapp-templates' | 'connections' | 'stock';
export type PrivateSettingsSave = {previousRevision:number;savedRevision:number};
type Listener = { area: PrivateSettingsArea; refresh: (saved:PrivateSettingsSave) => unknown | Promise<unknown> };
const listeners = new Set<Listener>();

/** Only our own successful saves trigger this; every pane still reads the server. */
export async function privateSettingsSaved(area: PrivateSettingsArea, previousRevision:number, savedRevision:number) {
  if(!Number.isSafeInteger(previousRevision)||!Number.isSafeInteger(savedRevision)||savedRevision!==previousRevision+1)return;
  await Promise.allSettled([...listeners].filter(listener => listener.area !== area).map(listener => Promise.resolve().then(()=>listener.refresh({previousRevision,savedRevision}))));
}

export function usePrivateSettingsRefresh(area: PrivateSettingsArea, refresh: (saved:PrivateSettingsSave) => unknown | Promise<unknown>) {
  const callback = useRef(refresh); callback.current = refresh;
  useEffect(() => {
    const listener = { area, refresh: (saved:PrivateSettingsSave) => callback.current(saved) };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [area]);
}
