import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { defaultWhatsAppTemplates, whatsappTemplateVariables, type WhatsAppTemplate } from '@workspace/vehicle-meta';

export type WhatsAppTemplatesResponse = { revision: number; templates: WhatsAppTemplate[]; variables: readonly string[] };
export const whatsappTemplatesQueryKey = ['whatsapp-templates'] as const;
const standaloneClient = new QueryClient();
export function useWhatsAppTemplates(active = true) {
  const client = useContext(QueryClientContext);
  const query = useQuery({
    queryKey: whatsappTemplatesQueryKey,
    queryFn: () => customFetch<WhatsAppTemplatesResponse>('/api/staff/whatsapp-templates'),
    enabled: active && Boolean(client), staleTime: 30_000, retry: false,
  }, client ?? standaloneClient);
  return { ...query, templates: query.data?.templates ?? defaultWhatsAppTemplates, variables: query.data?.variables ?? whatsappTemplateVariables };
}
