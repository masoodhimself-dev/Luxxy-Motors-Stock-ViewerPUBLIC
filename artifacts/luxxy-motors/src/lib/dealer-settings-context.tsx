import { getGetDealerSettingsQueryKey, useGetDealerSettings } from '@workspace/api-client-react';
import { useMemo } from 'react';
import { dealerConfig } from '@/config/dealer';
import type { DealerConfig } from '@/config/dealer';
import type { DealerSettings } from '@workspace/api-client-react';

const fallbackSettings = dealerConfig as DealerConfig & DealerSettings;

export function useDealerSettings() {
  const query = useGetDealerSettings({
    query: { queryKey: getGetDealerSettingsQueryKey() },
  });

  const settings = useMemo(() => {
    const source = query.data ?? fallbackSettings;
    const wording = (text: string) => text.replace(/book a viewing/gi, 'Book a test drive').replace(/arrange a viewing/gi, 'book a test drive');
    return {...source, bookViewing: {...source.bookViewing, title: wording(source.bookViewing.title), description: wording(source.bookViewing.description), ctaLabel: wording(source.bookViewing.ctaLabel)}, hero: {...source.hero, subcopy: wording(source.hero.subcopy)}};
  }, [query.data]);
  return {
    settings,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}