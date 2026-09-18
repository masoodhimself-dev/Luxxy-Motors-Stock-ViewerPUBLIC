import { cn } from "@/lib/utils";

/** A drawn Luxxy mark; other dealerships retain their configured name or uploaded logo. */
export function DealerWordmark({
  name,
  logoText,
  logoAsset,
  className,
}: {
  name: string;
  logoText?: string;
  logoAsset?: string;
  className?: string;
}) {
  if (logoAsset)
    return (
      <img
        src={logoAsset}
        alt={name}
        className={cn("h-10 max-w-[min(48vw,15rem)] object-contain", className)}
      />
    );
  const label = logoText || name;
  if (!/^luxxy\s+motors$/i.test(label.trim())) {
    return (
      <span
        className={cn(
          "block max-w-[48vw] break-words font-display text-lg font-semibold leading-tight tracking-tight",
          className,
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <svg
      role="img"
      aria-label={name}
      viewBox="0 0 174 48"
      className={cn("h-11 w-[160px] max-w-[46vw] shrink-0", className)}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path d="M3 3V29H25 M36 3V19C36 33 58 33 58 19V3 M72 3L93 29 M93 3L72 29 M106 3L127 29 M127 3L106 29 M140 3L153 18L166 3 M153 18V29" />
      </g>
      <text
        x="86"
        y="45"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="Arial, sans-serif"
        fontSize="8"
        letterSpacing="6"
      >
        MOTORS
      </text>
    </svg>
  );
}
