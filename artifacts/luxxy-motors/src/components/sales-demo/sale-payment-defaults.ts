import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { defaultSalePaymentDefaults, type InvoiceSettings, type SalePaymentDefaults } from '@workspace/vehicle-meta';

export const salePaymentDefaultsQueryKey = ['sale-workspace', 'payment-defaults'] as const;

export function useSalePaymentDefaults(enabled = true) {
  return useQuery({
    queryKey: salePaymentDefaultsQueryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const paperwork = await customFetch<{ invoiceSettings?: InvoiceSettings; paymentDefaults?: SalePaymentDefaults }>('/api/sale-workspace/paperwork', { signal });
      return {
        paymentDefaults: paperwork.paymentDefaults ?? defaultSalePaymentDefaults,
        paymentInstructions: paperwork.invoiceSettings?.paymentInstructions ?? '',
      };
    },
  });
}
