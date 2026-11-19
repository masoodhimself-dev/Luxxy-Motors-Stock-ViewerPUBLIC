const names = ['calendar', 'shield-check', 'heart', 'arrow-right', 'arrow-left', 'chevron-down', 'chevron-right', 'phone', 'car', 'map-pin', 'check', 'share-2', 'menu'] as const;
export type GraphiteIconName = typeof names[number];

/** Exact vectors from the approved Figma file, served locally. */
export function GraphiteIcon({ name, className }: { name: GraphiteIconName; className?: string }) {
  return <img src={`/brand/graphite/icon-${name}.svg`} alt="" aria-hidden="true" width={24} height={24} className={`gr-icon${className ? ` ${className}` : ''}`} />;
}
