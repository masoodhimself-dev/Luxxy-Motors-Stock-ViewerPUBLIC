import { forwardRef, useEffect, useState } from "react";
import { Link } from "wouter";
import type { DealerConfig } from "@/config/dealer";
import { getPhoneHref } from "@/lib/cta-helpers";
import { formatPhoneDisplay } from "@/lib/utils";
import { multiChoiceHomeSections } from "@/lib/multi-choice-home-sections";
import { Menu, Phone, ChevronDown, MoreHorizontal, Heart } from "./icons";
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
  { settings: MultiHomeSettings; savedCount: number; testDriveHref: string }
>(function MultiHomeHeader({ settings, savedCount, testDriveHref }, ref) {
  const [drawerOpen, setDrawerOpen] = useState(false),
    [servicesOpen, setServicesOpen] = useState(false),
    [moreOpen, setMoreOpen] = useState(false);
  const sections = multiChoiceHomeSections(settings),
    phoneHref = getPhoneHref(settings),
    phone = formatPhoneDisplay(settings.contact.phone ?? "");
  const canBook = Boolean(settings.testDriveBooking?.enabled);
  const savedLabel =
    savedCount > 0 ? `Saved cars (${savedCount})` : "Saved cars";
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth >= 1100) setDrawerOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  function close() {
    setDrawerOpen(false);
    setServicesOpen(false);
    setMoreOpen(false);
  }
  return (
    <header ref={ref} data-site-header className="multi-home-header">
      <div className="multi-home-header__inner">
        <a
          href="#top"
          className="multi-home-header__brand"
          aria-label={`${settings.identity.name} home`}
          onClick={close}
        >
          <img
            src="/brand/multi-choice-motors/multi-choice-wordmark.svg"
            alt={settings.identity.name}
            width="205"
            height="43"
          />
        </a>
        <nav
          aria-label="Primary navigation"
          className="multi-home-header__desktop"
        >
          <Link href="/stock">Search cars</Link>
          {sections.partExchange && <a href="#part-exchange">Part exchange</a>}
          {(sections.warranty || sections.delivery) && (
            <Popover open={servicesOpen} onOpenChange={setServicesOpen}>
              <PopoverTrigger asChild>
                <button type="button" className="multi-home-header__disclosure">
                  Services <ChevronDown aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="multi-home-popover" align="start">
                <nav aria-label="Services">
                  {sections.warranty && (
                    <a href="#warranty" onClick={close}>
                      Warranty
                    </a>
                  )}
                  {sections.delivery && (
                    <a href="#delivery" onClick={close}>
                      Delivery
                    </a>
                  )}
                </nav>
              </PopoverContent>
            </Popover>
          )}
          {sections.reviews && <a href="#reviews">Reviews</a>}
          <a href="#contact">Contact</a>
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="multi-home-header__more"
                aria-label="More links"
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="multi-home-popover" align="end">
              <nav aria-label="More dealership links">
                <Link href="/saved" onClick={close}>
                  <Heart aria-hidden="true" />
                  {savedLabel}
                </Link>
                <a href="#about" onClick={close}>
                  About us
                </a>
                {canBook && (
                  <Link href={testDriveHref} onClick={close}>
                    {settings.bookViewing.ctaLabel}
                  </Link>
                )}
              </nav>
            </PopoverContent>
          </Popover>
        </nav>
        <div className="multi-home-header__actions">
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
                <SheetTitle>Multi-Choice Motors</SheetTitle>
                <SheetDescription>
                  Cars, services and your next visit.
                </SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile navigation">
                <Link href="/stock" onClick={close}>
                  Search cars
                </Link>
                {sections.partExchange && (
                  <a href="#part-exchange" onClick={close}>
                    Part exchange
                  </a>
                )}
                {sections.warranty && (
                  <a href="#warranty" onClick={close}>
                    Warranty
                  </a>
                )}
                {sections.delivery && (
                  <a href="#delivery" onClick={close}>
                    Delivery
                  </a>
                )}
                {sections.reviews && (
                  <a href="#reviews" onClick={close}>
                    Reviews
                  </a>
                )}
                <a href="#contact" onClick={close}>
                  Contact
                </a>
                <Link href="/saved" onClick={close}>
                  <Heart aria-hidden="true" />
                  {savedLabel}
                </Link>
                <a href="#about" onClick={close}>
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
