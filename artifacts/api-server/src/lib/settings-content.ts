/** Preserve optional onboarding content when an older settings client omits it. Explicit empty strings clear fields. */
export function preservePresentation<
  T extends { presentation?: Record<string, string | undefined> },
>(incoming: T, previous: unknown): T {
  const content =
    previous && typeof previous === "object" && "presentation" in previous
      ? previous.presentation
      : undefined;
  if (!content || typeof content !== "object" || Array.isArray(content))
    return incoming;
  return {
    ...incoming,
    presentation: { ...content, ...incoming.presentation },
  };
}
