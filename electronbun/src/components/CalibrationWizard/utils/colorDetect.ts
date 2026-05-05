import type { FlashColor } from "../types";

/** Convert sRGB channel (0–255) to linear light */
function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Convert RGB (0–255 each) to HSL. Returns [h(0–360), s(0–100), l(0–100)]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l * 100];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) / 6;
  } else {
    h = ((rn - gn) / d + 4) / 6;
  }

  return [h * 360, s * 100, l * 100];
}

/** Perceived luminance (0–1) for an RGB pixel */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Analyses an ImageBitmap, picks the top 10% brightest pixels and averages
 * their HSL hue to produce a FlashColor.
 *
 * A fixed tolerance of 30° is used as a reasonable starting point that the
 * user can override in Step 3.
 */
export function detectDominantBrightColor(bitmap: ImageBitmap): FlashColor {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context from OffscreenCanvas");
  }
  ctx.drawImage(bitmap, 0, 0);

  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const pixelCount = bitmap.width * bitmap.height;

  // Collect all pixel luminances
  type PixelEntry = { lum: number; r: number; g: number; b: number };
  const pixels: PixelEntry[] = [];

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    pixels.push({ lum: luminance(r, g, b), r, g, b });
  }

  // Sort descending by luminance
  pixels.sort((a, b) => b.lum - a.lum);

  // Take top 10%
  const topCount = Math.max(1, Math.floor(pixelCount * 0.1));
  const topPixels = pixels.slice(0, topCount);

  // Average HSL of top pixels
  let hSinSum = 0;
  let hCosSum = 0;
  let sSum = 0;
  let lSum = 0;

  for (const px of topPixels) {
    const [h, s, l] = rgbToHsl(px.r, px.g, px.b);
    // Circular mean for hue
    const rad = (h * Math.PI) / 180;
    hSinSum += Math.sin(rad);
    hCosSum += Math.cos(rad);
    sSum += s;
    lSum += l;
  }

  const avgHRad = Math.atan2(hSinSum / topCount, hCosSum / topCount);
  const avgH = ((avgHRad * 180) / Math.PI + 360) % 360;
  const avgS = sSum / topCount;
  const avgL = lSum / topCount;

  return {
    h: Math.round(avgH),
    s: Math.round(avgS),
    l: Math.round(avgL),
    tolerance: 30,
  };
}
