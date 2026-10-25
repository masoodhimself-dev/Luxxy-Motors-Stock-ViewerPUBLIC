import { replaceEqualDeep } from '@tanstack/react-query';
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { getGetDealerSettingsQueryKey, getGetDealerSettingsQueryOptions as generatedQueryOptions, useGetDealerSettings as generatedUseQuery } from './generated/api';
import { customFetch, retainSettingsRevision, type ErrorType } from './custom-fetch';
import type { ApiError, DealerSettings } from './generated/api.schemas';

/** Keep optimistic-concurrency metadata when the shared public settings cache reuses JSON. */
const shareSettings = (previous: unknown, next: unknown) => retainSettingsRevision(replaceEqualDeep(previous, next), next);
type SettingsOptions<TData, TError> = {
  query?: UseQueryOptions<DealerSettings, TError, TData>;
  request?: Parameters<typeof customFetch>[1];
};

export function getGetDealerSettingsQueryOptions<TData = DealerSettings, TError = ErrorType<ApiError>>(options?: SettingsOptions<TData, TError>) {
  return generatedQueryOptions({ ...options, query: { queryKey: getGetDealerSettingsQueryKey(), ...options?.query, structuralSharing: shareSettings } }) as UseQueryOptions<DealerSettings, TError, TData> & { queryKey: QueryKey };
}

export function useGetDealerSettings<TData = DealerSettings, TError = ErrorType<ApiError>>(options?: SettingsOptions<TData, TError>) {
  return generatedUseQuery<TData, TError>({ ...options, query: { queryKey: getGetDealerSettingsQueryKey(), ...options?.query, structuralSharing: shareSettings } });
}
