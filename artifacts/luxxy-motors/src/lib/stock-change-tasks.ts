import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type StockChangeSettings = { minimumReduction: number; contactIntervalDays: number; revision: number };
export type StockChangeCustomerOutcome = {
  status: 'pending' | 'contacted' | 'not_needed' | 'follow_up';
  revision: number;
  channel: 'call' | 'email' | 'whatsapp' | null;
  followUpAt: string | null;
  note: string | null;
  updatedAt: string | null;
};
export type StockChangeCustomer = {
  enquiryId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  appointmentAt: string | null;
  appointmentStatus: string | null;
  outcome?: StockChangeCustomerOutcome;
  outreach?: { suggested: boolean; reason: 'below_minimum_reduction' | 'recently_contacted' | null; lastContactedAt: string | null; nextContactAt: string | null };
};

export type StockChangeTask = {
  id: string;
  kind: 'price_drop' | 'missing_stock';
  status: 'open' | 'reviewed' | 'resolved';
  revision: number;
  createdAt: string;
  updatedAt: string;
  vehicleId: string;
  vehicleTitle: string;
  registration: string | null;
  imageUrl: string | null;
  previousPrice: number | null;
  currentPrice: number | null;
  reduction: number | null;
  missingCount: number;
  lastSeenAt: string | null;
  publiclyVisible: boolean;
  availableForPriceUpdate?: boolean;
  urgency: 'urgent' | 'normal';
  affectedCustomers: StockChangeCustomer[];
  customerTotal?: number;
  pendingCustomerTotal?: number;
  upcomingAppointments: number;
  paidReservations: number;
  priceDropSettings?: StockChangeSettings;
};

export type StockChangeTasksResponse = {
  tasks: StockChangeTask[];
  total: number;
  generatedAt: string;
};

export const stockChangeTasksQueryKey = ['staff-stock-change-tasks'] as const;

export function useStockChangeTasks() {
  return useQuery({
    queryKey: stockChangeTasksQueryKey,
    queryFn: () => customFetch<StockChangeTasksResponse>('/api/staff/stock-change-tasks'),
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export const stockChangeSettingsQueryKey = ['staff-stock-change-settings'] as const;
export function useStockChangeSettings() {
  return useQuery({ queryKey: stockChangeSettingsQueryKey, queryFn: () => customFetch<StockChangeSettings>('/api/staff/stock-change-settings'), retry: false });
}

export function stockChangeDraftLink(taskId: string, enquiryId: string, channel: 'email' | 'whatsapp' = 'email') {
  return `/portal?section=notifications&workView=email&compose=${encodeURIComponent(enquiryId)}&stockChangeId=${encodeURIComponent(taskId)}${channel === 'whatsapp' ? '&channel=whatsapp' : ''}`;
}
