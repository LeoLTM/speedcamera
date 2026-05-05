import type { FlashColor } from "../types";

/** Returns the angular distance between two hue values (0–360), always 0–180. */
function hueDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Scores an ImageBitmap against a target FlashColor.
 *
 * A pixel is counted as a match when:
 *  - Its hue is within `flashColor.h ± flashColor.tolerance`
 *  - Its saturation is ≥ 20%
 *  - Its lightness is in [40%, 95%]
 *
 * Returns the ratio of matching pixels to total pixels (0–1).
 * Higher scores indicate the flash was more visible/well-timed.
 */
export function scoreImage(bitmap: ImageBitmap, flashColor: FlashColor): number {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context from OffscreenCanvas");
  }
  ctx.drawImage(bitmap, 0, 0);

  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const pixelCount = bitmap.width * bitmap.height;

  let matchCount = 0;

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];

    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = ((max + min) / 2) * 100;

    if (l < 40 || l > 95) continue;

    const d = max - min;
    if (d === 0) continue; // achromatic

    const s = (l > 50 ? d / (2 - max - min) : d / (max + min)) * 100;
    if (s < 20) continue;

    let h = 0;
    if (max === rn) {
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    } else if (max === gn) {
      h = ((bn - rn) / d + 2) / 6;
    } else {
      h = ((rn - gn) / d + 4) / 6;
    }
    h = h * 360;

    if (hueDelta(h, flashColor.h) <= flashColor.tolerance) {
      matchCount++;
    }
  }

  return pixelCount > 0 ? matchCount / pixelCount : 0;
}
