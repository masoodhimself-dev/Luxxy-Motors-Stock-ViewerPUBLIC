export function RouteLoading() {
  return (
    <div
      className="container mx-auto min-h-[65vh] px-4 py-10 sm:px-6"
      role="status"
      aria-label="Loading page"
    >
      <span className="sr-only">Loading page…</span>
      <div className="h-7 w-48 animate-pulse bg-muted" />
      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <div className="aspect-[4/3] animate-pulse bg-muted" />
        <div className="h-64 animate-pulse bg-muted" />
      </div>
    </div>
  );
}
