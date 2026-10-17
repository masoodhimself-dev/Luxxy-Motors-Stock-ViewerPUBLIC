import { getGetEnquiriesQueryKey, useGetEnquiries } from "@workspace/api-client-react";

export const enquirySummaryKey = (base: readonly unknown[] = getGetEnquiriesQueryKey()) => base.at(-1) === "timeline-omitted" ? base : [...base, "timeline-omitted"];

/** Customer/case matching retains every record; conversation pages load only when opened. */
export const useEnquirySummaries: typeof useGetEnquiries = (params, options) => {
  const headers = new Headers(options?.request?.headers);
  headers.set("X-Enquiry-Timeline", "omit");
  return useGetEnquiries(params, { ...options, query: { ...options?.query, queryKey: enquirySummaryKey(options?.query?.queryKey ?? getGetEnquiriesQueryKey(params)) }, request: { ...options?.request, headers } });
};
