import { getMakeLogoSrc } from '@/lib/make-logo';

interface MakeLogoProps {
  make: string | null | undefined;
  size?: number;
  width?: number;
  height?: number;
  className?: string;
}

/** Decorative alongside a visible make name, keeping the label announced only once. */
export function MakeLogo({ make, size = 32, width = size, height = size, className }: MakeLogoProps) {
  const src = getMakeLogoSrc(make);
  if (!src) return null;

  return <img
    src={src}
    alt=""
    aria-hidden="true"
    width={width}
    height={height}
    className={className}
    loading="lazy"
    decoding="async"
    draggable={false}
    style={{ objectFit: 'contain', flexShrink: 0 }}
  />;
}
