import { Link } from "wouter";
import { ArrowRight, MapPin, Phone } from "lucide-react";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { formatPhoneDisplay } from "@/lib/utils";
import { Button } from "./ui/button";
import { ShowroomPhoto } from "./showroom-photo";
import { DealershipPhotograph } from './dealership-photograph';
import { dealershipPhotography } from '@/lib/dealership-photography';

export function DealershipVisit({ children }: { children?: React.ReactNode }) {
  const { settings } = useDealerSettings();
  const { address, contact, hours, presentation: content = {} } = settings;
  const photography = dealershipPhotography(settings);
  const visitPhoto = photography.visit || photography.introduction;
  const hasTeam = Boolean(content.teamImageUrl && content.teamIntroduction?.trim() && !/^sample|tell customers|replace this/i.test(content.teamIntroduction.trim()));
  const hasStory = Boolean(
    hasTeam ||
    content.reviewsUrl,
  );
  const addressLines = [
    address?.street,
    address?.city,
    address?.region,
    address?.postcode,
  ].filter(Boolean);
  return (
    <section
      id="visit"
      className="border-t border-border bg-card py-8 md:py-10"
      aria-labelledby="visit-heading"
    >
      <div id="about" className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className={`grid items-start gap-6 lg:gap-10 ${hasStory || visitPhoto || children ? "lg:grid-cols-2" : "max-w-4xl"}`}
        >
          <div>
            <h2 id="visit-heading" tabIndex={-1} className="section-heading">
              Plan your visit
            </h2>
            <p className="mt-4 max-w-lg whitespace-pre-line text-sm leading-7 text-muted-foreground">
              {content.visitInstructions ||
                "Arrange a viewing and take a closer look. Contact the team for directions and appointment details before setting off."}
            </p>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Find us</h3>
                <address className="mt-3 not-italic text-sm leading-6 text-muted-foreground">
                  {addressLines.length
                    ? addressLines.map((line, i) => <div key={i}>{line}</div>)
                    : "Contact the showroom for directions."}
                </address>
                {address?.mapsUrl && (
                  <a
                    className="text-link mt-2"
                    href={address.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MapPin className="h-4 w-4" /> Get directions
                  </a>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold">Opening hours</h3>
                {hours?.length ? (
                  <dl className="mt-3 space-y-2 text-sm">
                    {hours.map((hour, i) => (
                      <div key={i}>
                        <dt className="text-muted-foreground">{hour.days}</dt>
                        <dd>{hour.times}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Please contact us to confirm a suitable time.
                  </p>
                )}
              </div>
            </div>
            {content.parkingInstructions && (
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">When you arrive</h3>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                  {content.parkingInstructions}
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/enquire?type=viewing">
                  Arrange a viewing <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/contact">
                  Contact & directions <MapPin className="h-4 w-4" />
                </Link>
              </Button>
              {contact.phone && (
                <a
                  className="text-link"
                  href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}
                >
                  <Phone className="h-4 w-4" />
                  {formatPhoneDisplay(contact.phone)}
                </a>
              )}
            </div>
          </div>
          {(hasStory || visitPhoto || children) && (
            <div className="visit-story grid gap-5">
              {visitPhoto && <DealershipPhotograph photo={visitPhoto} />}
              {children}
              {hasTeam && (
                <div className="border-t border-border pt-5">
                  {content.teamImageUrl && (
                    <ShowroomPhoto
                      src={content.teamImageUrl}
                      alt={content.teamImageAlt || "The dealership team"}
                      className="mb-5 aspect-[16/9]"
                    />
                  )}
                  <h3 className="section-heading">Meet the team</h3>
                  {content.teamIntroduction && (
                    <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                      {content.teamIntroduction}
                    </p>
                  )}
                </div>
              )}
              {content.reviewsUrl && (
                <div className="border-y border-border py-5">
                  <h3 className="text-base font-semibold">
                    Hear from our customers
                  </h3>
                  <a
                    href={content.reviewsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link mt-2"
                  >
                    Read customer reviews <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
