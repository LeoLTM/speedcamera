import { useEffect, useState } from "react";
import { getRpc } from "@/lib/rpc";
import type { Violation } from "@/shared/types";

export interface ViolationImageOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "webp" | "jpeg" | "png" | "auto";
}

/**
 * Fetches a compressed violation thumbnail or full-res image (raw or Poliscan-skinned).
 * Shared by ViolationRow and ViolationGridTile to dedupe fetch effects.
 */
export function useViolationImage(
  violation: Violation,
  skinEnabled: boolean,
  options?: ViolationImageOptions,
) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  const width = options?.width;
  const height = options?.height;
  const quality = options?.quality;
  const format = options?.format;

  useEffect(() => {
    let cancelled = false;
    setImageLoading(true);
    const fetchImage = skinEnabled
      ? getRpc().request.getSkinnedImageData({ violationId: violation.id, width, height, quality, format })
      : getRpc().request.getImageData({ imagePath: violation.imagePath, width, height, quality, format });
    fetchImage
      .then((data) => { if (!cancelled) setImageData(data); })
      .catch(() => { if (!cancelled) setImageData(null); })
      .finally(() => { if (!cancelled) setImageLoading(false); });
    return () => { cancelled = true; };
  }, [violation.imagePath, violation.id, skinEnabled, width, height, quality, format]);

  return { imageData, imageLoading };
}
