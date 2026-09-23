import { ShowroomPhoto } from '@/components/showroom-photo';
import type { DealershipPhoto } from '@/lib/dealership-photography';

export function DealershipPhotograph({ photo, className, priority = false }: {
  photo: DealershipPhoto;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={className}>
      <ShowroomPhoto src={photo.src} alt={photo.alt} priority={priority} className="aspect-[16/9]" />
      {photo.caption && <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">{photo.caption}</figcaption>}
    </figure>
  );
}
