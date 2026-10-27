import { useDealerFeatures } from './dealer-features';
import { getGetDealerSettingsQueryKey, useGetDealerSettings } from '@workspace/api-client-react';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { dealerConfig } from '@/config/dealer';
import type { DealerConfig } from '@/config/dealer';
import type { DealerSettings } from '@workspace/api-client-react';

const sharedFallback = {
  ...dealerConfig,
  identity: { name: '', logoText: '', logoAsset: '' }, contact: { phone: '', whatsapp: '', email: '' },
  address: { street: '', city: '', region: '', postcode: '', mapsUrl: '' }, hours: [],
  legal: { companyName: '', companyNumber: '', vatNumber: '', termsUrl: '', privacyUrl: '', cookieUrl: '' }, social: { instagram: '', facebook: '', twitter: '' },
  hero: { announcement: '', copy: 'Browse used cars', subcopy: '', primaryCta: 'Browse Stock', secondaryCta: '' },
  warranty: { ...dealerConfig.warranty!, enabled: false }, delivery: { ...dealerConfig.delivery!, enabled: false }, partExchange: { ...dealerConfig.partExchange!, enabled: false },
  presentation: {}, trustItems: [], whyBuy: [],
};
const fallbackSettings = (import.meta.env.VITE_MULTI_TENANT_ENABLED === 'true' ? sharedFallback : dealerConfig) as DealerConfig & DealerSettings;

/** Keep copied practice settings and public pages consistent without changing saved settings. */
export function normaliseDealerWording<T extends Pick<DealerConfig, 'bookViewing' | 'hero'>>(source: T): T {
  const wording = (text: string) => text.replace(/book a viewing/gi, 'Book a test drive').replace(/arrange a viewing/gi, 'book a test drive');
  return {...source, bookViewing: {...source.bookViewing, title: wording(source.bookViewing.title), description: wording(source.bookViewing.description), ctaLabel: /^(book|arrange) a (test drive|viewing)$/i.test(source.bookViewing.ctaLabel.trim()) ? 'Book a Test Drive' : wording(source.bookViewing.ctaLabel)}, hero: {...source.hero, subcopy: wording(source.hero.subcopy)}};
}

const CustomerPreviewSettings = createContext<typeof fallbackSettings | null>(null);
/** Override public components with copied practice settings inside a customer preview. */
export function CustomerPreviewSettingsProvider({settings,children}:{settings:typeof fallbackSettings;children:ReactNode}) {
  return <CustomerPreviewSettings.Provider value={settings}>{children}</CustomerPreviewSettings.Provider>;
}

export function useDealerSettings() {
  const previewSettings = useContext(CustomerPreviewSettings);
  const features = useDealerFeatures();
  const query = useGetDealerSettings({
    query: { queryKey: getGetDealerSettingsQueryKey() },
  });

  const settings = useMemo(() => {
    const saved = previewSettings ?? query.data ?? fallbackSettings;
    const source = { ...saved,
      testDriveBooking: saved.testDriveBooking ? { ...saved.testDriveBooking, enabled: !!saved.testDriveBooking.enabled && features.enabled('testDriveBookings') } : undefined,
      partExchange: saved.partExchange ? { ...saved.partExchange, enabled: !!saved.partExchange.enabled && features.enabled('partExchange') } : undefined,
    };
    return normaliseDealerWording(source);
  }, [query.data, previewSettings, features.data, features.isError]);
  return {
    settings,
    publicEnquiriesEnabled: features.enabled('publicEnquiries'),
    isLoading: query.isLoading || features.isLoading,
    isError: query.isError || features.isError,
  };
}
