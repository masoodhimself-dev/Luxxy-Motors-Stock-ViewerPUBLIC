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

