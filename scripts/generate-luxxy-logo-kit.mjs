import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve("deliverables/luxxy-motors-logo-kit");
const archive = resolve("deliverables/luxxy-motors-logo-kit.zip");

const colors = {
  ink: "#17363D",
  brass: "#DEB148",
  ivory: "#F1EAD3",
  sage: "#E7ECE4",
  muted: "#6A7B76",
};

const outer =
  "m129.6 8.6h-109.1c-5.5.1-11.1 4.7-11.1 10.7v93.5c0 15.6 12.2 28.6 29.3 28.6h73.3c15.7 0 28.4-11.3 28.4-27.5v-94.6c0-5.8-4.6-10.7-10.8-10.7z";
const l1 =
  "m93.5 114.5h-53.5c-1.5 0-2.6-1.1-2.6-2.8v-82.3h-10.1v82c0 6.1 4.9 11.4 11.7 11.4h60.4l-5.9-8.3z";
const l2 = "m51.4 29.4h-10.2l.1 81 49.4-.1-6.5-9.9h-32.8z";
const x1 =
  "m99.6 71.3 22.8-30.5v-11.4h-4.5l-25 33.3-24.7 32.6h12.5l3.3-4 21.3 31.5h5.8c2.4 0 4.5-.6 6.4-2l-27.1-37.6 2.6-3.2 27.3 38c1.2-1.8 2.1-4 2.1-6.4v-10z";
const x2 =
  "m64.1 29.5h-9l19.4 34.8-18.2 24v7.1h7.1l49.9-65.9-12.9-.1-11.1 14.4-8.9-14.4-11.7.1 14.2 22.7-2.6 3.5z";

function ensure(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function save(relativePath, content) {
  const file = join(root, relativePath);
  ensure(file);
  writeFileSync(file, `${content.trim()}\n`);
  return file;
}

function svgShell(width, height, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
  ${body}
</svg>`;
}

function fullColorMark({ background = colors.ink, l = colors.brass, x = colors.ivory } = {}) {
  return `<path fill="${background}" d="${outer}"/>
  <path fill="${l}" d="${l1}"/>
  <path fill="${l}" d="${l2}"/>
  <path fill="${x}" d="${x1}"/>
  <path fill="${x}" d="${x2}"/>`;
}

function monoMark(color, maskId) {
  return `<defs>
    <mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="150" height="150">
      <path fill="#fff" d="${outer}"/>
      <path fill="#000" d="${l1}"/>
      <path fill="#000" d="${l2}"/>
      <path fill="#000" d="${x1}"/>
      <path fill="#000" d="${x2}"/>
    </mask>
  </defs>
  <rect width="150" height="150" fill="${color}" mask="url(#${maskId})"/>`;
}

function wordmark(color) {
  return `<g fill="none" stroke="${color}" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter">
    <path d="M0 0V48H28"/>
    <path d="M45 0V31C45 42 51 48 61 48C71 48 77 42 77 31V0"/>
    <path d="M94 0L126 48M126 0L94 48"/>
    <path d="M143 0L175 48M175 0L143 48"/>
    <path d="M192 0L208 24L224 0M208 24V48"/>
  </g>`;
}

function primaryLockup() {
  return svgShell(
    720,
    160,
    `<g transform="translate(16 8) scale(.96)">${fullColorMark()}</g>
    <g transform="translate(190 43)">${wordmark(colors.ink)}</g>
    <text x="190" y="119" fill="${colors.muted}" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="4.6">MOTORS · HARROW</text>`,
    "Luxxy Motors Harrow primary logo",
  );
}

function reverseLockup({ field = false } = {}) {
  return svgShell(
    720,
    160,
    `${field ? `<rect width="720" height="160" rx="22" fill="${colors.ink}"/>` : ""}
    <g transform="translate(16 8) scale(.96)">${monoMark(colors.ivory, "reverse-mark")}</g>
    <g transform="translate(190 43)">${wordmark(colors.ivory)}</g>
    <text x="190" y="119" fill="${colors.brass}" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="4.6">MOTORS · HARROW</text>`,
    "Luxxy Motors Harrow reverse logo",
  );
}

function wordmarkOnly(color, taglineColor) {
  return svgShell(
    520,
    104,
    `<g transform="translate(10 14) scale(1.28)">${wordmark(color)}</g>
    <text x="10" y="96" fill="${taglineColor}" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="4.4">MOTORS · HARROW</text>`,
    "Luxxy Motors Harrow wordmark",
  );
}

function socialAvatar() {
  return svgShell(
    1080,
    1080,
    `<rect width="1080" height="1080" rx="220" fill="${colors.sage}"/>
    <g transform="translate(210 210) scale(4.4)">${fullColorMark()}</g>`,
    "Luxxy Motors social profile image",
  );
}

function ogArtwork() {
  return svgShell(
    1200,
    630,
    `<rect width="1200" height="630" fill="${colors.ink}"/>
    <circle cx="1080" cy="90" r="220" fill="${colors.brass}" opacity=".1"/>
    <circle cx="1090" cy="590" r="340" fill="${colors.sage}" opacity=".06"/>
    <g transform="translate(90 125) scale(1.6)">${monoMark(colors.ivory, "og-mark")}</g>
    <g transform="translate(370 214) scale(1.8)">${wordmark(colors.ivory)}</g>
    <text x="370" y="340" fill="${colors.brass}" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="7">MOTORS · HARROW</text>
    <line x1="370" x2="1030" y1="405" y2="405" stroke="${colors.brass}" stroke-width="2" opacity=".55"/>
    <text x="370" y="472" fill="${colors.ivory}" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" letter-spacing=".5">The considered way to buy used.</text>`,
    "Luxxy Motors Open Graph artwork",
  );
}

rmSync(root, { recursive: true, force: true });
rmSync(archive, { force: true });

save("svg/luxxy-mark-primary.svg", svgShell(150, 150, fullColorMark(), "Luxxy Motors Harrow Mark"));
save(
  "svg/luxxy-mark-light.svg",
  svgShell(
    150,
    150,
    fullColorMark({ background: colors.ivory, l: colors.brass, x: colors.ink }),
    "Luxxy Motors Harrow Mark light",
  ),
);
save("svg/luxxy-mark-mono-ink.svg", svgShell(150, 150, monoMark(colors.ink, "mono-ink"), "Luxxy Motors Harrow Mark monochrome ink"));
save("svg/luxxy-mark-mono-white.svg", svgShell(150, 150, monoMark("#FFFFFF", "mono-white"), "Luxxy Motors Harrow Mark monochrome white"));
save("svg/luxxy-lockup-horizontal.svg", primaryLockup());
save("svg/luxxy-lockup-horizontal-reverse.svg", reverseLockup());
save("svg/luxxy-lockup-dark-field.svg", reverseLockup({ field: true }));
save("svg/luxxy-wordmark.svg", wordmarkOnly(colors.ink, colors.muted));
save("svg/luxxy-wordmark-reverse.svg", wordmarkOnly(colors.ivory, colors.brass));
save("social/luxxy-social-avatar.svg", socialAvatar());
save("social/luxxy-open-graph.svg", ogArtwork());

save(
  "tokens/luxxy-brand-tokens.json",
  JSON.stringify(
    {
      name: "Luxxy Motors",
      direction: "Premium and understated editorial automotive concierge",
      colors: {
        ink: colors.ink,
        brass: colors.brass,
        ivory: colors.ivory,
        sage: colors.sage,
        muted: colors.muted,
      },
      typography: {
        display: "Instrument Serif",
        interface: "DM Sans",
        logoFallback: "DejaVu Sans",
      },
      logo: {
        preferred: "svg/luxxy-lockup-horizontal.svg",
        icon: "svg/luxxy-mark-primary.svg",
        minimumDigitalIconSize: "32px",
        clearSpace: "At least half the icon width on every side",
      },
    },
    null,
    2,
  ),
);

save(
  "tokens/luxxy-brand.css",
  `:root {
  --luxxy-ink: ${colors.ink};
  --luxxy-brass: ${colors.brass};
  --luxxy-ivory: ${colors.ivory};
  --luxxy-sage: ${colors.sage};
  --luxxy-muted: ${colors.muted};
  --luxxy-display-font: "Instrument Serif", Georgia, serif;
  --luxxy-interface-font: "DM Sans", Arial, sans-serif;
}`,
);

save(
  "README.md",
  `# Luxxy Motors logo kit

Approved direction: **Concept 03 — The Harrow Mark**

## Recommended use

- Use \`svg/luxxy-lockup-horizontal.svg\` on light and sage backgrounds.
- Use \`svg/luxxy-lockup-horizontal-reverse.svg\` on dark photographic or ink backgrounds.
- Use \`svg/luxxy-mark-primary.svg\` for favicons, mobile app icons, social avatars, and small badges.
- Use the mono SVGs for vinyl decals, embroidery, stamps, and single-colour print.
- Keep clear space around the logo equal to at least half the icon width.
- Do not recolour, distort, rotate, outline, or add effects to the mark.
- Do not use the full lockup below 150px wide; switch to the icon-only mark.

## Package contents

- Editable, scalable SVG logo variants
- Transparent PNG lockups at 1x, 2x, and 3x
- App and favicon PNG sizes plus multi-size ICO
- Social avatar and Open Graph artwork
- JSON and CSS design tokens

## Core colours

- Ink: ${colors.ink}
- Brass: ${colors.brass}
- Ivory: ${colors.ivory}
- Sage: ${colors.sage}
- Muted interface text: ${colors.muted}
`,
);

const magick = (args) => execFileSync("magick", args, { stdio: "inherit" });

const render = (input, output, geometry) => {
  ensure(join(root, output));
  magick(["-background", "none", join(root, input), "-resize", geometry, join(root, output)]);
};

render("svg/luxxy-lockup-horizontal.svg", "png/luxxy-lockup-1x.png", "720x160");
render("svg/luxxy-lockup-horizontal.svg", "png/luxxy-lockup-2x.png", "1440x320");
render("svg/luxxy-lockup-horizontal.svg", "png/luxxy-lockup-3x.png", "2160x480");
render("svg/luxxy-lockup-dark-field.svg", "png/luxxy-lockup-dark-1x.png", "720x160");
render("svg/luxxy-lockup-dark-field.svg", "png/luxxy-lockup-dark-2x.png", "1440x320");
render("svg/luxxy-lockup-dark-field.svg", "png/luxxy-lockup-dark-3x.png", "2160x480");

for (const size of [16, 32, 48, 64, 180, 192, 512, 1024]) {
  render("svg/luxxy-mark-primary.svg", `icons/luxxy-icon-${size}.png`, `${size}x${size}`);
}

magick([
  join(root, "svg/luxxy-mark-primary.svg"),
  "-background",
  "none",
  "-define",
  "icon:auto-resize=16,32,48,64",
  join(root, "icons/favicon.ico"),
]);

render("social/luxxy-social-avatar.svg", "social/luxxy-social-avatar.png", "1080x1080");
render("social/luxxy-open-graph.svg", "social/luxxy-open-graph.png", "1200x630");

mkdirSync(dirname(archive), { recursive: true });
execFileSync("zip", ["-r", "-q", archive, "luxxy-motors-logo-kit"], {
  cwd: dirname(root),
});

console.log(`Generated ${root}`);
console.log(`Generated ${archive}`);