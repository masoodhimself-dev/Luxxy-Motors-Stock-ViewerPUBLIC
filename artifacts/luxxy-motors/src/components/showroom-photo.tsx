import { useState } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
export function ShowroomPhoto({
  src,
  alt,
  className,
  priority = false,
  fit = "cover",
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  fit?: "cover" | "contain";
}) {
  const [failedSrc, setFailedSrc] = useState("");
  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {failedSrc === src ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Camera className="h-5 w-5" />
          Photograph unavailable
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          width={1200}
          height={900}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onError={() => setFailedSrc(src)}
          className={cn("absolute inset-0 h-full w-full", fit === "contain" ? "object-contain" : "object-cover")}
        />
      )}
    </div>
  );
}
