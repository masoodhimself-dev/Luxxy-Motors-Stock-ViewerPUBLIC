import { useContext, useSyncExternalStore } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useCustomerPreview } from './customer-preview-context';

export type VehicleWatch = { id: string; vehicleId: string; vehicleTitle: string; vehicleUrl: string; status: 'active' | 'stopped'; verifiedAt?: string | null; imageUrl?: string | null; currentPrice?: number | null; currency?: string };
export type WatchManagement = { watches: VehicleWatch[]; expiresAt: string; dealerName?: string; emailHint?: string; token?: string; verificationRequired?: boolean; vehicleTitle?: string };
const key = `luxxy.vehicle-watches.v1:${import.meta.env.BASE_URL}`;
const event = 'luxxy:vehicle-watches';
const standaloneClient = new QueryClient();
const subscribers = (listener: () => void) => {
  window.addEventListener('storage', listener); window.addEventListener(event, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(event, listener); };
};
function stored() { try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; } }
export function watchAccess() {
  try { const value = JSON.parse(stored()); return /^[A-Za-z0-9_-]{43}$/.test(value.token) && Date.parse(value.expiresAt) > Date.now() ? value as { token: string; expiresAt: string } : null; } catch { return null; }
}
export function rememberWatchAccess(token: string, expiresAt: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !(Date.parse(expiresAt) > Date.now())) return false;
  let saved = false;
  try { window.localStorage.setItem(key, JSON.stringify({ token, expiresAt })); saved = true; } catch { /* The emailed link still works in private browsers. */ }
  window.dispatchEvent(new Event(event));
  return saved;
}
export function useWatchAccess() { useSyncExternalStore(subscribers, stored, () => ''); return watchAccess(); }
export function forgetWatchAccess() { try { window.localStorage.removeItem(key); } catch { /* Storage is optional. */ } window.dispatchEvent(new Event(event)); }
export async function watchRequest<T>(path: string, input?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/vehicle-watches${path}`, { method: input === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    headers: { Accept: 'application/json', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { 'x-vehicle-watch-token': token } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'This request could not be completed. Please try again.');
  return data as T;
}
export function useWatchAvailability() {
  const preview = useCustomerPreview();
  const client = useContext(QueryClientContext);
  return useQuery({ queryKey: ['vehicle-watch-availability'], queryFn: () => watchRequest<{ enabled: boolean; emailReady: boolean }>('/availability'), enabled: Boolean(client) && !preview, retry: false, staleTime: 30_000 }, client ?? standaloneClient);
}
export function useWatchManagement() {
  const preview = useCustomerPreview();
  const raw = useSyncExternalStore(subscribers, preview ? () => '' : stored, () => '');
  const access = preview ? null : watchAccess();
  const client = useContext(QueryClientContext);
  const query = useQuery({ queryKey: ['vehicle-watch-management', raw], queryFn: () => watchRequest<WatchManagement>('/manage', undefined, access!.token), enabled: Boolean(client && access), retry: false, staleTime: 0 }, client ?? standaloneClient);
  return { ...query, data: access && !query.isError ? query.data : undefined, access };
}
