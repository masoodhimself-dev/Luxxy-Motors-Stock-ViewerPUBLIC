export * from "./generated/api";
export * from "./generated/api.schemas";
export { getGetDealerSettingsQueryOptions, useGetDealerSettings } from './dealer-settings-query';
export {
  setBaseUrl,
  setAuthTokenGetter,
  customFetch,
  getSettingsRevision,
  ApiError as HttpApiError,
} from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
