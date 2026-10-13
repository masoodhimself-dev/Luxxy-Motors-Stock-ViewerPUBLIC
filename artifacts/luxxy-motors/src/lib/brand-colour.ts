function hslToRelativeLuminance(hsl: string) {
  const values = hsl.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!values || values.length < 3) return null;
  const [rawHue, rawSaturation, rawLightness] = values;
  const hue = ((rawHue % 360) + 360) % 360 / 360;
  const saturation = Math.min(100, Math.max(0, rawSaturation)) / 100;
  const lightness = Math.min(100, Math.max(0, rawLightness)) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue * 12) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [red, green, blue] = [channel(0), channel(8), channel(4)].map(linear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function readableForegroundForHsl(hsl: string) {
  const backgroundLuminance = hslToRelativeLuminance(hsl);
  if (backgroundLuminance == null) return '0 0% 100%';
  const dark = '0 0% 8%';
  const light = '0 0% 100%';
  const darkLuminance = hslToRelativeLuminance(dark) ?? 0;
  const lightLuminance = hslToRelativeLuminance(light) ?? 1;
  const contrastWithDark = (Math.max(backgroundLuminance, darkLuminance) + 0.05) / (Math.min(backgroundLuminance, darkLuminance) + 0.05);
  const contrastWithLight = (Math.max(backgroundLuminance, lightLuminance) + 0.05) / (Math.min(backgroundLuminance, lightLuminance) + 0.05);
  return contrastWithDark >= contrastWithLight ? dark : light;
}

// A button can use dark text on a bright brand colour, but the same colour
// cannot serve as readable small text on the showroom's light surfaces.
// Retain the dealer hue and saturation, lowering lightness only when needed.
export function readableAccentForHsl(hsl: string) {
  const values = hsl.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!values || values.length < 3) return '203.226 58.491% 31.176%';
  const [hue, saturation, lightness] = values;
  for (let candidate = Math.min(100, Math.max(0, lightness)); candidate >= 0; candidate = Math.max(0, candidate - 0.5)) {
    const colour = `${hue} ${Math.min(100, Math.max(0, saturation))}% ${candidate}%`;
    const luminance = hslToRelativeLuminance(colour) ?? 0;
    // Slight headroom over 4.5 keeps labels legible on the off-white canvas.
    if (1.05 / (luminance + 0.05) >= 5) return candidate === lightness ? hsl : colour;
    if (candidate === 0) break;
  }
  return '203.226 58.491% 31.176%';
}

export function hexColourLuminance(hex: string) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}

export function hexColourContrast(first: string, second: string) {
  const values = [hexColourLuminance(first), hexColourLuminance(second)];
  return (Math.max(...values) + .05) / (Math.min(...values) + .05);
}

export function hexColourToHsl(hex: string) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue);
  const delta = maximum - minimum, lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta) {
    hue = maximum === red ? ((green - blue) / delta + (green < blue ? 6 : 0))
      : maximum === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    hue *= 60;
  }
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return `${Number(hue.toFixed(3))} ${Number((saturation * 100).toFixed(3))}% ${Number((lightness * 100).toFixed(3))}%`;
}

export function hslColourToHex(value: string, fallback = '#192a36') {
  const match = value.trim().replace(/,/g, ' ').match(/^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match || Number(match[2]) > 100 || Number(match[3]) > 100) return fallback;
  const [hue, saturation, lightness] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = ((offset + hue / 30) % 12 + 12) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Keep the saved hue; adjust only unreadable text, against its actual surface. */
export function readableHexOnSurface(text: string, surface: string, minimumContrast = 4.5) {
  if (hexColourContrast(text, surface) >= minimumContrast) return text;
  const [hue, saturation, lightness] = hexColourToHsl(text).match(/[\d.]+/g)!.map(Number);
  // Search both directions so a dark panel can retain a pale version of the
  // same dealer colour instead of falling back to the light-page dark ink.
  for (let difference = .5; difference <= 100; difference += .5) {
    for (const candidate of [lightness - difference, lightness + difference]) {
      if (candidate < 0 || candidate > 100) continue;
      const colour = hslColourToHex(`${hue} ${saturation}% ${candidate}%`);
      if (hexColourContrast(colour, surface) >= minimumContrast + .1) return colour;
    }
  }
  return hexColourContrast('#ffffff', surface) >= hexColourContrast('#141414', surface) ? '#ffffff' : '#141414';
}

