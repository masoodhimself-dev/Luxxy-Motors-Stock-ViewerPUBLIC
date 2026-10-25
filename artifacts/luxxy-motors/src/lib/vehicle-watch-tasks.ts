import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type VehicleWatchKind = 'price_drop' | 'reserved' | 'available_again' | 'sold';
export type VehicleWatchRecipient = { id: string; email: string; status: 'pending' | 'sent' | 'failed' | 'uncertain'; sentAt: string | null };
export type VehicleWatchTask = {
  id: string; vehicleId: string; vehicleTitle: string; vehicleUrl: string;
  kind: VehicleWatchKind; revision: number; previousPrice: number | null; currentPrice: number | null;
  createdAt: string; subject: string; message: string; recipients: VehicleWatchRecipient[];
  pendingCount: number; totalCount: number; uncertainCount?: number;
};
export type VehicleWatchTasksResponse = { tasks: VehicleWatchTask[]; total: number };
export type VehicleWatchPreview = {
  subject: string; message: string; recipients: { id: string; email: string }[];
  previewHash: string; expectedRevision: number; ready: boolean; preview?: boolean;
};
export type VehicleWatchSendResult = { sentCount: number; skippedCount: number; failedCount: number; uncertainCount: number; message: string };
export type VehicleWatchSettings = { enabled: boolean; revision: number; emailReady: boolean; repliesReady?: boolean };

export const vehicleWatchTasksKey = ['staff-vehicle-watch-tasks'] as const;
export const vehicleWatchCountsKey = ['staff-vehicle-watch-counts'] as const;
export const vehicleWatchSettingsKey = ['staff-vehicle-watch-settings'] as const;
export function useVehicleWatchTasks() {
  return useQuery({ queryKey: vehicleWatchTasksKey, queryFn: () => customFetch<VehicleWatchTasksResponse>('/api/staff/vehicle-watch-tasks'), retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true });
}
export function useVehicleWatchCounts() {
  return useQuery({ queryKey: vehicleWatchCountsKey, queryFn: () => customFetch<{ counts: { vehicleId: string; count: number }[] }>('/api/staff/vehicle-watch-counts'), retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true });
}
export function useVehicleWatchSettings() {
  return useQuery({ queryKey: vehicleWatchSettingsKey, queryFn: () => customFetch<VehicleWatchSettings>('/api/staff/vehicle-watch-settings'), retry: false });
}
export const vehicleWatchTaskPath = (taskId: string) => `/api/staff/vehicle-watch-tasks/${encodeURIComponent(taskId)}`;
export const vehicleWatchKindLabel: Record<VehicleWatchKind, string> = { price_drop: 'Price reduced', reserved: 'Reserved', available_again: 'Available again', sold: 'Sold' };
