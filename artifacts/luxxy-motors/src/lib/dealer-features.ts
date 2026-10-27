import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type DealerFeatureKey =
  | "testDriveBookings"
  | "testDriveDeclarations"
  | "customerEmails"
  | "publicEnquiries"
  | "partExchange";
export type DealerFeatures = {
  features: Record<DealerFeatureKey, boolean>;
  evaluatedAt: string;
};
export function useDealerFeatures() {
  const query = useQuery({
    queryKey: ["dealer-features"],
    queryFn: () => customFetch<DealerFeatures>("/api/features"),
    staleTime: 5 * 60_000,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    isSuccess: query.isSuccess,
    error: query.error,
    refetch: query.refetch,
    enabled: (feature: DealerFeatureKey) =>
      !query.isError && query.data?.features?.[feature] === true,
  };
}
