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
