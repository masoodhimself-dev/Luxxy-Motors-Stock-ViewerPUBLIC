/** Public brand photography only; these images are not actual staff or stock. */
export const hasMultiChoicePhotography = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "") === "multichoicemotors";

const descriptions = {
  "vehicle-delivery": "Vehicle delivery to a UK home",
  "part-exchange": "A customer handing over car keys for part exchange",
  "customer-service": "A customer discussing a car with an adviser",
};
export function DealerServicePhoto({ dealerName, service }: {
  dealerName: string;
  service: keyof typeof descriptions;
}) {
  if (!hasMultiChoicePhotography(dealerName)) return null;
  const base = `/brand/multi-choice-motors/services/${service}`;
  return <img className="dealer-service-photo" src={`${base}-800.webp`}
    srcSet={`${base}-480.webp 480w, ${base}-800.webp 800w, ${base}-1200.webp 1200w`}
    sizes="(max-width: 640px) calc(100vw - 32px), (max-width: 1024px) 45vw, 400px"
    width={1200} height={800} loading="lazy" decoding="async"
    alt={descriptions[service]} />;
}
