import { Link } from "wouter";
import type { MultiHomeSettings } from "./multi-home-header";
import { multiChoiceHomeSections } from "@/lib/multi-choice-home-sections";
import { getEnquiryHref } from "@/lib/cta-helpers";
import { Facebook, Instagram, Twitter } from "./icons";
import "./multi-home-chrome.css";

export function MultiHomeFooter({
  settings,
  enquiriesEnabled = false,
  isHomepage = true,
}: {
  settings: MultiHomeSettings;
  enquiriesEnabled?: boolean;
  isHomepage?: boolean;
}) {
  const sections = multiChoiceHomeSections(settings),
    legal = settings.legal;
  const sectionHref = (id: string) => `${isHomepage ? "" : "/"}#${id}`;
  const partExchangeHref =
    !isHomepage && enquiriesEnabled
      ? "/enquire?type=part_exchange"
      : sectionHref("part-exchange");
  const PartExchangeLink = !isHomepage && enquiriesEnabled ? Link : "a";
  const WarrantyLink = isHomepage ? "a" : Link;
  const ContactLink = isHomepage ? "a" : Link;
  const LogoLink = isHomepage ? "a" : Link;
  const socialLinks = [
    { label: "Instagram", href: settings.social.instagram, Icon: Instagram },
    { label: "Facebook", href: settings.social.facebook, Icon: Facebook },
    { label: "X / Twitter", href: settings.social.twitter, Icon: Twitter },
  ].flatMap((item) => {
    try {
      const url = new URL(item.href || "");
      return ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? [{ ...item, href: url.href }]
        : [];
    } catch {
      return [];
    }
  });
  return (
    <footer
      className="multi-home-footer"
      aria-label={`${settings.identity.name} information`}
    >
      <nav aria-label="Dealership links" className="multi-home-footer__links">
        <Link href="/stock">Search cars</Link>
        {sections.partExchange && (
          <PartExchangeLink href={partExchangeHref}>
            Part exchange
          </PartExchangeLink>
        )}
        {sections.warranty && (
          <WarrantyLink href={isHomepage ? "#warranty" : "/warranty"}>
            Warranty
          </WarrantyLink>
        )}
        {sections.delivery && <a href={sectionHref("delivery")}>Delivery</a>}
        <Link href="/saved">Saved cars</Link>
        <a href={sectionHref("about")}>About us</a>
        <ContactLink href={isHomepage ? "#contact" : "/contact"}>
          Contact
        </ContactLink>
        {enquiriesEnabled && (
          <Link href={getEnquiryHref("general")}>Send an enquiry</Link>
        )}
      </nav>
      {socialLinks.length > 0 && (
        <nav aria-label="Follow us" className="multi-home-footer__social">
          {socialLinks.map(({ label, href, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
            >
              <Icon size={20} aria-hidden="true" />
            </a>
          ))}
        </nav>
      )}
      <LogoLink
        href={isHomepage ? "#top" : "/"}
        className="multi-home-footer__brand"
        aria-label={`${settings.identity.name} home`}
      >
        <img
          src="/brand/multi-choice-motors/multi-choice-wordmark.svg"
          alt={settings.identity.name}
          width="190"
          height="40"
          loading="lazy"
        />
      </LogoLink>
      <div className="multi-home-footer__legal">
        <p>
          © {new Date().getFullYear()}{" "}
          {legal.companyName?.trim() || settings.identity.name}. All rights
          reserved.
        </p>
        {(legal.companyNumber || legal.vatNumber) && (
          <p>
            {[
              legal.companyNumber ? `Company no. ${legal.companyNumber}` : "",
              legal.vatNumber ? `VAT no. ${legal.vatNumber}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {(legal.privacyUrl || legal.termsUrl || legal.cookieUrl) && (
          <nav aria-label="Legal information">
            {legal.privacyUrl && <a href={legal.privacyUrl}>Privacy policy</a>}
            {legal.termsUrl && (
              <a href={legal.termsUrl}>Terms &amp; conditions</a>
            )}
            {legal.cookieUrl && <a href={legal.cookieUrl}>Cookies</a>}
          </nav>
        )}
      </div>
    </footer>
  );
}
