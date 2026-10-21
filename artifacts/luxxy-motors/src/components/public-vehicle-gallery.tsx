import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Gallery, type GalleryProps } from './gallery';

export function PublicVehicleGallery(props: GalleryProps) {
  const vehicleId = props.car?.id;
  const { data } = useQuery({
    queryKey: ['public-car-video', vehicleId],
    queryFn: () => customFetch<{ video: { url: string; preview?: boolean } | null }>(`/api/vehicles/${vehicleId}/video`),
    enabled: Boolean(vehicleId),
    retry: false,
  });
  const sharedVideo = new URLSearchParams(window.location.search).get('video') === '1';
  useEffect(() => {
    if (data?.video && sharedVideo) document.getElementById('walkaround')?.scrollIntoView({ block: 'center' });
  }, [data?.video?.url, sharedVideo]);
  return <Gallery {...props} video={data?.video || undefined} initialVideo={sharedVideo} />;
}
