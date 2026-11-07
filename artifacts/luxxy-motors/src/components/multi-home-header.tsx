import { forwardRef, useEffect, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import type { DealerConfig } from "@/config/dealer";
import { getPhoneHref } from "@/lib/cta-helpers";
import { formatPhoneDisplay } from "@/lib/utils";
import { multiChoiceHomeSections } from "@/lib/multi-choice-home-sections";
import { isMultiChoiceWebsite } from "@/lib/multi-home-scope";
import { getFittedShoreDriveLogo } from "@/lib/shore-drive-wordmark";
import { DealerWordmark } from "./brand/wordmark";
import { Menu, Phone, ChevronDown, Heart } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import "./multi-home-chrome.css";

export type MultiHomeSettings = DealerConfig & {
  testDriveBooking?: { enabled: boolean };
};
export const MultiHomeHeader = forwardRef<
  HTMLElement,
  {
    settings: MultiHomeSettings;
    savedCount: number;
    testDriveHref: string;
    isHomepage?: boolean;
    enquiriesEnabled?: boolean;
    onLogoClick?: () => void;
  }
>(function MultiHomeHeader(
  {
    settings,
    savedCount,
    testDriveHref,
    isHomepage = true,
    enquiriesEnabled = true,
    onLogoClick,
  },
  ref,
) {
  const [drawerOpen, setDrawerOpen] = useState(false),
    [servicesOpen, setServicesOpen] = useState(false);
  const sections = multiChoiceHomeSections(settings),
    phoneHref = getPhoneHref(settings),
    phone = formatPhoneDisplay(settings.contact.phone ?? "");
  const canBook = Boolean(settings.testDriveBooking?.enabled);
  const sectionHref = (id: string) => `${isHomepage ? "" : "/"}#${id}`;
  const partExchangeHref =
    !isHomepage && enquiriesEnabled
      ? "/enquire?type=part_exchange"
      : sectionHref("part-exchange");
  const PartExchangeLink = !isHomepage && enquiriesEnabled ? Link : "a";
  const ContactLink = isHomepage ? "a" : Link;
  const LogoLink = isHomepage ? "a" : Link;
  const fittedLogo = isMultiChoiceWebsite()
    ? "/brand/multi-choice-motors/multi-choice-wordmark.svg"
    : getFittedShoreDriveLogo(settings.identity.logoAsset, "header");
  const savedLabel =
    savedCount > 0 ? `Saved cars (${savedCount})` : "Saved cars";
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth >= 1100) setDrawerOpen(false);
      else setServicesOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  function close() {
    setDrawerOpen(false);
    setServicesOpen(false);
  }
  return (
    <header ref={ref} data-site-header className="multi-home-header">
      <div className="multi-home-header__inner">
        <LogoLink
          href={isHomepage ? "#top" : "/"}
          className="multi-home-header__brand"
          aria-label={`${settings.identity.name} home`}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            close();
            if (
              !isHomepage &&
              onLogoClick &&
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              onLogoClick();
            }
          }}
        >
          {fittedLogo ? <img
            src={fittedLogo}
            alt={settings.identity.name}
            width="205"
            height="43"
          /> : <DealerWordmark {...settings.identity} />}
        </LogoLink>
        <nav
          aria-label="Primary navigation"
          className="multi-home-header__desktop"
        >
          <Link href="/stock">Search cars</Link>
          {sections.partExchange && (
            <PartExchangeLink href={partExchangeHref} onClick={close}>
              Part exchange
            </PartExchangeLink>
          )}
          {(sections.warranty || sections.delivery || canBook) && (
            <Popover open={servicesOpen} onOpenChange={setServicesOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="multi-home-header__disclosure">
                  Services <ChevronDown aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="multi-home-popover" align="start">
                <nav aria-label="Services">
                  {canBook && (
                    <Link href={testDriveHref} onClick={close}>
                      {settings.bookViewing.ctaLabel}
                    </Link>
                  )}
                  {sections.warranty && (
                    <Link
                      href="/warranty"
                      onClick={close}
                    >
                      Warranty
                    </Link>
                  )}
                  {sections.delivery && (
                    <a href={sectionHref("delivery")} onClick={close}>
                      Delivery
                    </a>
                  )}
                </nav>
              </PopoverContent>
            </Popover>
          )}
          <a href={sectionHref("about")} onClick={close}>
            About us
          </a>
          {sections.reviews && (
            <a href={sectionHref("reviews")} onClick={close}>
              Reviews
            </a>
          )}
          <ContactLink
            href={isHomepage ? "#contact" : "/contact"}
            onClick={close}
          >
            Contact us
          </ContactLink>
        </nav>
        <div className="multi-home-header__actions">
          <Link
            href="/saved"
            className="multi-home-header__saved"
            aria-label={savedLabel}
          >
            <Heart aria-hidden="true" />
            {savedCount > 0 && <span aria-hidden="true">{savedCount}</span>}
          </Link>
          {phoneHref && (
            <a
              href={phoneHref}
              className="multi-home-header__phone"
              aria-label={`Call ${settings.identity.name} on ${phone}`}
            >
              <Phone aria-hidden="true" />
              <span>{phone}</span>
            </a>
          )}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="multi-home-header__menu"
                aria-label="Open navigation menu"
              >
                <Menu aria-hidden="true" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="multi-home-drawer">
              <SheetHeader>
                <SheetTitle>{settings.identity.name}</SheetTitle>
                <SheetDescription className="sr-only">Website navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile navigation">
                <Link href="/stock" onClick={close}>
                  Search cars
                </Link>
                {sections.partExchange && (
                  <PartExchangeLink href={partExchangeHref} onClick={close}>
                    Part exchange
                  </PartExchangeLink>
                )}
                {sections.warranty && (
                  <Link
                    href="/warranty"
                    onClick={close}
                  >
                    Warranty
                  </Link>
                )}
                {sections.delivery && (
                  <a href={sectionHref("delivery")} onClick={close}>
                    Delivery
                  </a>
                )}
                {sections.reviews && (
                  <a href={sectionHref("reviews")} onClick={close}>
                    Reviews
                  </a>
                )}
                <ContactLink
                  href={isHomepage ? "#contact" : "/contact"}
                  onClick={close}
                >
                  Contact us
                </ContactLink>
                <Link href="/saved" onClick={close}>
                  <Heart aria-hidden="true" />
                  {savedLabel}
                </Link>
                <a href={sectionHref("about")} onClick={close}>
                  About us
                </a>
                {canBook && (
                  <Link href={testDriveHref} onClick={close}>
                    {settings.bookViewing.ctaLabel}
                  </Link>
                )}
              </nav>
              {phoneHref && (
                <a href={phoneHref} className="multi-home-drawer__phone">
                  <Phone aria-hidden="true" />
                  {phone}
                </a>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
});
