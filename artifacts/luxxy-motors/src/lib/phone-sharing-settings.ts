import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type PhoneSharingSettings = { revision: number; enabled: boolean; invoiceQrEnabled?: boolean };
export const phoneSharingSettingsQueryKey = ['phone-sharing-settings'] as const;
export const readPhoneSharingSettings = () => customFetch<PhoneSharingSettings>('/api/staff/phone-sharing-settings');
// Isolated components without an app provider retain their existing behaviour.
// The server is authoritative and still rejects new packs when sharing is disabled.
const standaloneClient = new QueryClient();

export function usePhoneSharingSettings(active = true) {
  const client = useContext(QueryClientContext);
  const query = useQuery({
    queryKey: phoneSharingSettingsQueryKey,
    queryFn: readPhoneSharingSettings,
    enabled: active && Boolean(client),
    staleTime: 30_000,
    retry: false,
  }, client ?? standaloneClient);
  return { ...query, enabled: !client || query.data?.enabled === true, invoiceQrEnabled: query.data?.invoiceQrEnabled === true };
}
