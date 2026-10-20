import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type StockChangeCustomer = {
  enquiryId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  appointmentAt: string | null;
  appointmentStatus: string | null;
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
  urgency: 'urgent' | 'normal';
  affectedCustomers: StockChangeCustomer[];
  upcomingAppointments: number;
  paidReservations: number;
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

export function stockChangeDraftLink(taskId: string, enquiryId: string) {
  return `/portal?section=notifications&workView=email&compose=${encodeURIComponent(enquiryId)}&stockChangeId=${encodeURIComponent(taskId)}`;
}
