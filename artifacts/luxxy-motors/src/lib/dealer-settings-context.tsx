import { getGetDealerSettingsQueryKey, useGetDealerSettings } from '@workspace/api-client-react';
import { dealerConfig } from '@/config/dealer';
import type { DealerConfig } from '@/config/dealer';
import type { DealerSettings } from '@workspace/api-client-react';

const fallbackSettings = dealerConfig as DealerConfig & DealerSettings;

export function useDealerSettings() {
  const query = useGetDealerSettings({
    query: { queryKey: getGetDealerSettingsQueryKey() },
  });

  return {
    settings: query.data ?? fallbackSettings,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}