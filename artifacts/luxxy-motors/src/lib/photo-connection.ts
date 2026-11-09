/** Optional image preloading must respect the customer's data preference. */
export function shouldPrefetchVehiclePhotos(value: unknown): boolean {
  const connection = (
    value as {
      connection?: { saveData?: boolean; effectiveType?: string };
    } | null
  )?.connection;
  return (
    !connection?.saveData &&
    !["slow-2g", "2g"].includes(connection?.effectiveType ?? "")
  );
}
