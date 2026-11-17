const pagePrefix = /^\/dealers\/[a-z0-9][a-z0-9-]{1,62}(?=\/portal(?:\/|$))/;

export function sharedStaffPortalPage(
  doc: Pick<Document, "querySelector" | "location"> | undefined = typeof document === "undefined" ? undefined : document,
) {
  const publishableKey = doc?.querySelector<HTMLMetaElement>('meta[name="dealeros-staff-portal"]')?.content;
  if (!doc || !publishableKey) return null;
  const base = pagePrefix.exec(doc.location.pathname)?.[0] ?? "";
  return { publishableKey, base, dealerId: base ? base.slice("/dealers/".length) : null };
}

export function sharedStaffPortalPath(path: string) {
  return (sharedStaffPortalPage()?.base ?? "") + path;
}

export function sharedStaffWorkspacePath(dealerId: string) {
  return `/dealers/${encodeURIComponent(dealerId)}/portal`;
}
