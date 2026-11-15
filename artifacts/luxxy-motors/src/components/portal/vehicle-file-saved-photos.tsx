import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Camera, ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SavedPhoto = { id: string; category: string | null };

function photoCategoryLabel(category: string | null) {
  if (category === "pre_accident") return "Pre-accident photos";
  if (category === "service_book") return "Service-book photos";
  return "Other saved photos";
}

function SavedPhotoImage({ photoUrl, label }: { photoUrl: string; label: string }) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void customFetch<Blob>(photoUrl, {
      responseType: "blob",
      signal: controller.signal,
    }).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoUrl]);

  if (failed) return <p role="alert">This photo could not load. Close the preview and try again.</p>;
  if (!source) return <p role="status">Loading photo…</p>;
  return <img className="vehicle-file-saved-photo-image" src={source} alt={label} onError={() => setFailed(true)} />;
}

export function VehicleFileSavedPhotos({ vehicleId }: { vehicleId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{ id: string; label: string } | null>(null);
  const path = `/api/staff/inventory/${encodeURIComponent(vehicleId)}/photos`;
  const query = useQuery({
    queryKey: ["vehicle-file-saved-photos", vehicleId],
    queryFn: ({ signal }) => customFetch<{ photos: SavedPhoto[] }>(path, { signal }),
    enabled: expanded,
    retry: false,
    staleTime: 30_000,
  });
  const photosByCategory = new Map<string, SavedPhoto[]>();
  for (const photo of query.data?.photos ?? []) {
    const label = photoCategoryLabel(photo.category);
    const group = photosByCategory.get(label);
    if (group) group.push(photo);
    else photosByCategory.set(label, [photo]);
  }

  return (
    <>
      <details
        className="vehicle-file-saved-photos"
        onToggle={(event) => {
          if (event.currentTarget.open) setExpanded(true);
        }}
      >
        <summary>
          <Camera aria-hidden="true" size={17} />
          <span>Service-book and pre-accident photos</span>
          <ChevronDown aria-hidden="true" size={17} />
        </summary>
        {query.isPending && <p role="status">Loading saved photos…</p>}
        {query.isError && (
          <div className="vehicle-file-saved-photo-error" role="alert">
            <p>Saved photos could not load.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>
          </div>
        )}
        {query.isSuccess && photosByCategory.size === 0 && (
          <p>No service-book or pre-accident photos are saved.</p>
        )}
        {[...photosByCategory].map(([category, photos]) => (
          <section key={category}>
            <h4>{category}</h4>
            <ul>
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  <Button
                    variant="outline"
                    onClick={() => setPreview({ id: photo.id, label: `${category} · Photo ${index + 1}` })}
                    aria-label={`${category} · View photo ${index + 1}`}
                  >
                    View photo {index + 1}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </details>
      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        {preview && (
          <DialogContent className="vehicle-file-saved-photo-dialog sm:max-w-3xl" aria-describedby={undefined}>
            <DialogHeader className="pr-12">
              <DialogTitle>{preview.label}</DialogTitle>
            </DialogHeader>
            <SavedPhotoImage key={preview.id} photoUrl={`${path}/${encodeURIComponent(preview.id)}`} label={preview.label} />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
