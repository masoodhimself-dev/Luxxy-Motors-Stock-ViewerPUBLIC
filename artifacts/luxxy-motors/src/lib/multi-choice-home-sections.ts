import type { DealerConfig } from '@/config/dealer';

export function multiChoiceReviews(settings: DealerConfig) {
  if (settings.presentation?.reviewsEnabled === false) return [];
  return (settings.presentation?.reviews ?? []).filter(review =>
    Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5 &&
    Boolean(review.review?.trim() && review.name?.trim()));
}
export function multiChoiceReviewsUrl(settings: DealerConfig): string | undefined {
  if (settings.presentation?.reviewsEnabled === false) return undefined;
  try {
    const url = new URL(settings.presentation?.reviewsUrl || '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function multiChoiceHomeSections(settings: DealerConfig) {
  const services = settings.presentation?.servicesEnabled !== false;
  return {
    partExchange: settings.partExchange?.enabled === true,
    warranty: services && settings.warranty?.enabled === true,
    delivery: services && settings.delivery?.enabled === true,
    reviews: Boolean(multiChoiceReviewsUrl(settings) || multiChoiceReviews(settings).length),
    visit: settings.presentation?.visitEnabled !== false,
  };
}
