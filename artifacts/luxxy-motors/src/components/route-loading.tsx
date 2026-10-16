export function RouteLoading() {
  return (
    <div
      className="luxxy-shell mx-auto min-h-[65vh] px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      role="status"
      aria-label="Loading page"
      aria-busy="true"
    >
      <span className="sr-only">Loading page…</span>
      <div className="h-7 w-48 rounded-sm bg-muted motion-safe:animate-pulse" aria-hidden="true" />
      <div className="mt-7 grid gap-6 lg:grid-cols-2" aria-hidden="true">
        <div className="aspect-[4/3] rounded-sm bg-muted motion-safe:animate-pulse" />
        <div className="h-64 rounded-sm bg-muted motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
