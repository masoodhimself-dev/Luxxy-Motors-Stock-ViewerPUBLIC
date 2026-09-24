import { jsPDF } from "jspdf";
import {
  formatVehicleName,
  type VehicleMetaSource,
} from "@workspace/vehicle-meta";

export type BrochureVehicle = VehicleMetaSource &
  Record<string, unknown> & { id: string };
export type BrochureDealer = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  brochure?: BrochureOptions;
};
export type BrochureOptions = {
  title?: string;
  introduction?: string;
  accentColour?: string;
  footerNote?: string;
  includeDescription?: boolean;
  includeFeatures?: boolean;
  includeGallery?: boolean;
  photoLimit?: number;
  galleryLayout?: "grid" | "large";
};
export function brochureOptions(value: unknown): Required<BrochureOptions> {
  const options = record(value);
  return {
    title:
      brochureText(options.title).slice(0, 60) || "Your next car, in detail",
    introduction: brochureText(options.introduction).slice(0, 300),
    accentColour:
      typeof options.accentColour === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(options.accentColour)
        ? options.accentColour
        : "#835b33",
    footerNote: brochureText(options.footerNote).slice(0, 500),
    includeDescription: options.includeDescription !== false,
    includeFeatures: options.includeFeatures !== false,
    includeGallery: options.includeGallery !== false,
    photoLimit:
      typeof options.photoLimit === "number" &&
      Number.isInteger(options.photoLimit)
        ? Math.max(1, Math.min(80, options.photoLimit))
        : 12,
    galleryLayout: options.galleryLayout === "large" ? "large" : "grid",
  };
}
/** Shared mapping for the production and local-preview PDF routes. No writes or image requests. */
export function brochureDealer(config: unknown): BrochureDealer {
  const value = record(config),
    identity = record(value.identity),
    contact = record(value.contact),
    address = record(value.address);
  return {
    name: brochureText(identity.name) || "Vehicle showroom",
    phone: brochureText(contact.phone),
    email: brochureText(contact.email),
    address: ["street", "city", "region", "postcode"]
      .map((key) => brochureText(address[key]))
      .filter(Boolean)
      .join(", "),
    brochure: brochureOptions(value.brochure),
  };
}
export type BrochurePhoto = { url: string; caption: string };
export type LoadedPhoto = BrochurePhoto & {
  bytes?: Uint8Array;
  format?: "JPEG" | "PNG";
  width?: number;
  height?: number;
};

export function brochureText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .replace(/[\u2010-\u2015]/g, "-")
        .trim()
        .slice(0, 40_000)
    : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function brochurePhotos(vehicle: BrochureVehicle): BrochurePhoto[] {
  const photos: BrochurePhoto[] = [];
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const hero = brochureText(vehicle.heroImage);
  const source = hero ? [hero, ...images] : images;
  for (const image of source) {
    const url = brochureText(
      typeof image === "string" ? image : record(image).url,
    );
    if (!url || photos.some((photo) => photo.url === url)) continue;
    const original = images.find((item) => record(item).url === url);
    photos.push({
      url,
      caption: brochureText(record(original ?? image).caption),
    });
  }
  return photos;
}

/** A short brochure keeps a mix of supplied cabin/detail captions alongside exterior views. */
export function selectBrochurePhotos(photos: BrochurePhoto[], limit: number) {
  if (photos.length <= limit) return photos;
  const selected = photos.slice(0, 1);
  const add = (photo: BrochurePhoto) => {
    if (selected.length < limit && !selected.includes(photo))
      selected.push(photo);
  };
  photos
    .filter((photo) => /damage|scratch|wear/i.test(photo.caption))
    .slice(0, 1)
    .forEach(add);
  photos
    .filter((photo) =>
      /interior|cabin|dashboard|seat|boot/i.test(photo.caption),
    )
    .slice(0, 3)
    .forEach(add);
  photos
    .filter((photo) => /wheel|key|service|engine/i.test(photo.caption))
    .slice(0, 1)
    .forEach(add);
  photos.forEach(add);
  return selected;
}
function brochureVehicleName(vehicle: BrochureVehicle) {
  const name = formatVehicleName(vehicle),
    make = brochureText(vehicle.make);
  const year =
    typeof vehicle.year === "number" && name.startsWith(`${vehicle.year} `)
      ? `${vehicle.year} `
      : "";
  const base = name.slice(year.length);
  return make && base.toLowerCase().startsWith(`${make} ${make} `.toLowerCase())
    ? year + base.slice(make.length + 1)
    : name;
}

function numeric(value: unknown, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString("en-GB")}${suffix}`
    : "";
}

export function brochureDetails(vehicle: BrochureVehicle) {
  const sources = [
    vehicle,
    record(vehicle.specifications),
    record(vehicle.sourceExtras),
  ];
  const supplied = (...keys: string[]) => {
    for (const source of sources)
      for (const key of keys) {
        const value = source[key];
        const result = Array.isArray(value)
          ? value.map(brochureText).filter(Boolean).join(", ")
          : brochureText(value);
        if (result) return result;
      }
    return "";
  };
  let keys = "";
  for (const source of sources) {
    const count = source.numberOfKeys ?? source.keyCount;
    if (
      typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 0 &&
      count <= 20
    ) {
      keys = `${count} ${count === 1 ? "key" : "keys"}`;
      break;
    }
  }
  const specs = [
    [
      "Registration / year",
      brochureText(vehicle.registrationBand) ||
        brochureText(vehicle.registration) ||
        numeric(vehicle.year),
    ],
    [
      "Mileage",
      numeric(vehicle.mileage, " miles") || brochureText(vehicle.mileageText),
    ],
    ["Fuel", brochureText(vehicle.fuel)],
    ["Transmission", brochureText(vehicle.transmission)],
    [
      "Engine",
      brochureText(vehicle.engineSize) || numeric(vehicle.engineCC, " cc"),
    ],
    ["Body style", brochureText(vehicle.bodyType)],
    ["Colour", brochureText(vehicle.colour)],
    ["Doors", numeric(vehicle.doors)],
    ["Seats", numeric(vehicle.seats)],
    ["Drivetrain", brochureText(vehicle.drivetrain)],
    ["Emissions standard", brochureText(vehicle.emissionClass)],
    ["Previous owners", numeric(vehicle.owners)],
  ];
  const plate = brochureText(vehicle.plate) || brochureText(vehicle.vrm);
  if (plate) specs.push(["Number plate", plate]);
  return {
    name: brochureVehicleName(vehicle),
    variant: brochureText(vehicle.variant) || brochureText(vehicle.trim),
    specs,
    description: supplied("description"),
    features: (() => {
      const source = sources.find((item) => Array.isArray(item.features));
      return source
        ? (source.features as unknown[])
            .map(brochureText)
            .filter(Boolean)
            .slice(0, 250)
        : [];
    })(),
    history: ["S", "N"].includes(
      brochureText(vehicle.writeOffCategory).toUpperCase(),
    )
      ? `Category ${brochureText(vehicle.writeOffCategory).toUpperCase()}`
      : brochureText(vehicle.writeOffCategory),
    buyer: [
      ["Service history", supplied("serviceHistory")],
      ["MOT expiry", supplied("motExpiry", "motExpiryDate")],
      ["Keys", keys || supplied("keys")],
      ["Condition", supplied("conditionNotes", "condition")],
      ["Warranty", supplied("warrantyDetails", "warranty")],
      [
        "Included with this car",
        supplied("includedItems", "includedWithVehicle"),
      ],
    ],
  };
}

export function brochureFilename(vehicle: BrochureVehicle) {
  const name = brochureVehicleName(vehicle)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return `${name || "vehicle"}-details.pdf`;
}

/** A real text/vector PDF, not a screenshot of the web page. No network or DB access. */
export function renderVehicleBrochure(input: {
  vehicle: BrochureVehicle;
  dealer: BrochureDealer;
  photos: LoadedPhoto[];
  totalPhotos: number;
  vehicleUrl: string;
  preview?: boolean;
  generatedAt?: Date;
}): Buffer {
  const { vehicle, dealer } = input;
  const options = brochureOptions(dealer.brochure);
  const photos = input.photos.slice(
    0,
    options.includeGallery ? options.photoLimit : 1,
  );
  const details = brochureDetails(vehicle);
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  const ink = "#202c29";
  const muted = "#5b6562";
  const accent = options.accentColour;
  const margin = 16;
  const width = 178;
  const bottom = 268;
  let y = 0;
  const date = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/London",
  }).format(input.generatedAt ?? new Date());
  const clean = (text: string) =>
    brochureText(text)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\u2026/g, "...");
  const line = (at: number) => {
    doc.setDrawColor("#d7dad7");
    doc.setLineWidth(0.2);
    doc.line(margin, at, 194, at);
  };
  const header = () => {
    doc.setFillColor(accent);
    doc.rect(margin, 10, 12, 1.1, "F");
    doc.setTextColor(ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const brand = doc.splitTextToSize(
      clean(dealer.name || "Vehicle showroom"),
      115,
    ) as string[];
    doc.text(brand.slice(0, 2), margin, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(muted);
    doc.text(
      input.preview ? "PREVIEW / ARCHIVED STOCK" : "VEHICLE BROCHURE",
      194,
      20,
      { align: "right" },
    );
    line(30);
    y = 42;
  };
  const nextPage = () => {
    doc.addPage();
    header();
  };
  const ensure = (height: number) => {
    if (y + height > bottom) nextPage();
  };
  const text = (
    value: string,
    size = 10,
    colour = ink,
    bold = false,
    gap = 4,
  ) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(clean(value), width) as string[];
    for (const value of lines) {
      ensure(size * 0.46);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(colour);
      doc.text(value, margin, y);
      y += size * 0.46;
    }
    y += gap;
  };
  const heading = (value: string) => {
    ensure(28);
    doc.setFillColor(accent);
    doc.rect(margin, y - 5, 7, 0.8, "F");
    y += 3;
    text(value, 15, ink, true, 5);
  };
  const rows = (values: string[][]) => {
    for (const [label, value] of values) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(
        clean(value || "Please ask our team"),
        116,
      ) as string[];
      // Long imported notes can span pages without clipping or overlapping a footer.
      for (let index = 0; index < wrapped.length; index += 40) {
        const part = wrapped.slice(index, index + 40);
        const height = part.length * 4.7 + 7;
        ensure(height);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(muted);
        doc.text(index === 0 ? label : `${label} (continued)`, margin, y);
        doc.setFontSize(10);
        doc.setTextColor(value ? ink : muted);
        doc.text(part, 78, y, { lineHeightFactor: 1.33 });
        y += height;
        line(y - 4);
      }
    }
    y += 4;
  };
  const photograph = (
    photo: LoadedPhoto | undefined,
    x: number,
    top: number,
    boxWidth: number,
    boxHeight: number,
  ) => {
    doc.setFillColor("#f1f2ef");
    doc.rect(x, top, boxWidth, boxHeight, "F");
    if (photo?.bytes && photo.width && photo.height && photo.format) {
      const ratio = Math.min(boxWidth / photo.width, boxHeight / photo.height);
      const w = photo.width * ratio,
        h = photo.height * ratio;
      try {
        doc.addImage(
          photo.bytes,
          photo.format,
          x + (boxWidth - w) / 2,
          top + (boxHeight - h) / 2,
          w,
          h,
        );
        return;
      } catch {
        /* Malformed images stay explicitly unavailable. */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(muted);
    doc.text(
      photo ? "Photograph unavailable" : "No photographs supplied",
      x + boxWidth / 2,
      top + boxHeight / 2,
      { align: "center" },
    );
  };

  doc.setProperties({
    title: `${details.name} - vehicle details`,
    author: clean(dealer.name),
    subject: "Vehicle details and photographs",
  });
  header();
  text(options.title.toUpperCase(), 8, muted, false, 4);
  text(details.name, 25, ink, true, 1);
  if (details.variant) text(details.variant, 10, muted, false, 3);
  let price = "Price on application";
  if (
    typeof vehicle.price === "number" &&
    Number.isFinite(vehicle.price) &&
    vehicle.price >= 0
  ) {
    try {
      price = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: brochureText(vehicle.currency) || "GBP",
        maximumFractionDigits: 0,
      }).format(vehicle.price);
    } catch {
      price = `${vehicle.price.toLocaleString("en-GB")} ${brochureText(vehicle.currency)}`;
    }
  }
  text(price, 23, ink, true, 3);
  const priceType = brochureText(vehicle.priceType);
  if (priceType && !["cash", "fixed"].includes(priceType.toLowerCase()))
    text(priceType, 9, muted, false, 2);
  ensure(155);
  photograph(photos[0], margin, y, width, 105);
  y += 117;
  for (let i = 0; i < 6; i += 3) {
    ensure(18);
    for (let col = 0; col < 3; col++) {
      const [label, value] = details.specs[i + col];
      const x = margin + col * 61;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(muted);
      doc.text(label, x, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(ink);
      const wrapped = doc.splitTextToSize(
        clean(value || "Please ask our team"),
        55,
      ) as string[];
      doc.text(wrapped.slice(0, 2), x, y + 5);
    }
    y += 18;
  }
  if (details.history)
    text(
      `Insurance history: ${details.history}. Details on the following pages.`,
      8,
      muted,
      false,
      2,
    );
  line(y);
  y += 6;
  text(
    [dealer.phone, dealer.email].filter(Boolean).join("  |  ") || dealer.name,
    9,
    ink,
    false,
    1,
  );
  nextPage();
  heading("Vehicle specification");
  rows(details.specs);
  if (options.includeDescription) {
    heading("About this vehicle");
    text(
      details.description ||
        "Please ask our team for the full description, service history and preparation details.",
      10,
      muted,
    );
  }
  if (details.history) {
    heading("Insurance history");
    text(
      `${details.history} recorded. Ask our team for the available history, repair and inspection information.`,
      9,
      muted,
    );
  }
  // Keep the standard six-row buyer summary together when it fits on a page.
  ensure(100);
  heading("Before you decide");
  rows(details.buyer);
  if (options.includeFeatures && details.features.length) {
    heading("Features and equipment");
    for (const feature of details.features)
      text(`- ${feature}`, 10, ink, false, 2);
  }
  ensure(65);
  heading("Take a closer look");
  if (options.introduction) text(options.introduction, 11, muted);
  text(
    [dealer.name, dealer.address, dealer.phone, dealer.email]
      .filter(Boolean)
      .join("\n"),
    10,
    ink,
  );
  if (input.vehicleUrl) {
    ensure(14);
    doc.setFontSize(10);
    doc.setTextColor(ink);
    doc.textWithLink(
      "View this car online / enquire or arrange a viewing",
      margin,
      y,
      { url: input.vehicleUrl },
    );
    y += 10;
  }
  if (options.footerNote) text(options.footerNote, 9, muted);
  text(
    `Prepared ${date}. Details and price reflect the stock information available when this PDF was created. Please confirm availability and any unconfirmed details with the showroom.`,
    9,
    muted,
  );
  if (input.preview)
    text(
      "Local preview: this document contains archived stock and sample dealership information.",
      9,
      muted,
      true,
    );
  const unavailable = photos.filter((photo) => !photo.bytes).length;
  if (unavailable)
    text(
      `${unavailable} photograph(s) could not be included. Unavailable images are marked in this document. View the online listing for the latest photographs.`,
      9,
      muted,
    );
  if (input.totalPhotos > photos.length)
    text(
      `This document includes ${photos.length} of ${input.totalPhotos} photographs. The full gallery is available on the vehicle page.`,
      9,
      muted,
    );

  const perPage = options.galleryLayout === "large" ? 2 : 4;
  if (options.includeGallery)
    for (let offset = 1; offset < photos.length; offset += perPage) {
      nextPage();
      heading("A closer look");
      text(
        `Photographs ${offset + 1}-${Math.min(offset + perPage, photos.length)} of ${input.totalPhotos}`,
        8,
        muted,
        false,
        2,
      );
      photos.slice(offset, offset + perPage).forEach((photo, index) => {
        const large = options.galleryLayout === "large";
        const x = large ? margin : margin + (index % 2) * 92;
        const top = 60 + (large ? index : Math.floor(index / 2)) * 102;
        const photoWidth = large ? width : 86;
        photograph(photo, x, top, photoWidth, large ? 87 : 80);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(muted);
        const caption = clean(
          photo.caption || `Photograph ${offset + index + 1}`,
        );
        doc.text(
          (doc.splitTextToSize(caption, photoWidth) as string[]).slice(0, 2),
          x,
          top + (large ? 92 : 85),
        );
      });
    }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    line(278);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(muted);
    doc.text(
      `Prepared ${date}${input.preview ? " / Archived preview" : ""}`,
      margin,
      285,
    );
    doc.setFillColor(accent);
    doc.rect(margin, 290, 12, 0.8, "F");
    doc.text(`${page} / ${pages}`, 194, 285, { align: "right" });
  }
  return Buffer.from(doc.output("arraybuffer"));
}
