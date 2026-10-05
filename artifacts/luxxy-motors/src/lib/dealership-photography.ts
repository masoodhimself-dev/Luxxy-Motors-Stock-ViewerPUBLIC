import type { DealerConfig } from '@/config/dealer';
import reception from '@/assets/dealership/luxxy-reception.jpg';
import exterior from '@/assets/dealership/luxxy-exterior.jpg';
import forecourt from '@/assets/dealership/luxxy-forecourt.jpg';
import showroom from '@/assets/dealership/luxxy-showroom.jpg';

export interface DealershipPhoto {
  src: string;
  alt: string;
  caption?: string;
}

const illustrative = (src: string, description: string): DealershipPhoto => ({
  src,
  alt: `Illustrative Luxxy Motors showroom: ${description}`,
  caption: 'Illustrative showroom imagery',
});

/** Supplied template artwork must never replace a dealer's configured photography. */
export function dealershipPhotography(settings: DealerConfig) {
  const content = settings.presentation;
  const useTemplatePhotos = /^luxxy\s+motors$/i.test(settings.identity.name.trim())
    && !content?.showroomImageUrl && !content?.teamImageUrl;
  const configuredShowroom: DealershipPhoto | undefined = content?.showroomImageUrl
    ? { src: content.showroomImageUrl, alt: content.showroomImageAlt || `${settings.identity.name} showroom` }
    : undefined;
  const configuredTeam: DealershipPhoto | undefined = content?.teamImageUrl
    ? { src: content.teamImageUrl, alt: content.teamImageAlt || `The ${settings.identity.name} team` }
    : undefined;

  const configured = (subject: "visit" | "contact" | "reception"): DealershipPhoto | undefined => content?.[`${subject}ImageUrl`] ? { src: content[`${subject}ImageUrl`]!, alt: content[`${subject}ImageAlt`] || `${settings.identity.name} ${subject}` } : undefined;
  return {
    introduction: configuredShowroom ?? (useTemplatePhotos ? illustrative(showroom, 'vehicles displayed inside a bright showroom') : undefined),
    visit: configured("visit") ?? (useTemplatePhotos ? illustrative(forecourt, 'cars on the forecourt in front of the dealership') : undefined),
    contact: configured("contact") ?? configuredShowroom ?? (useTemplatePhotos ? illustrative(exterior, 'dealership frontage, entrance and forecourt') : undefined),
    reception: configured("reception") ?? configuredTeam ?? (useTemplatePhotos ? illustrative(reception, 'a customer speaking with a receptionist') : undefined),
  };
}
