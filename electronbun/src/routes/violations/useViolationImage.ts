import { useEffect, useState } from "react";
import { getRpc } from "@/lib/rpc";
import type { Violation } from "@/shared/types";

/**
 * Fetches a violation's image (raw or Poliscan-skinned) as a data-URL.
 * Shared by ViolationRow and ViolationGridTile to dedupe the fetch effect.
 */
export function useViolationImage(violation: Violation, skinEnabled: boolean) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setImageLoading(true);
    const fetchImage = skinEnabled
      ? getRpc().request.getSkinnedImageData({ violationId: violation.id })
      : getRpc().request.getImageData({ imagePath: violation.imagePath });
    fetchImage
      .then((data) => { if (!cancelled) setImageData(data); })
      .catch(() => { if (!cancelled) setImageData(null); })
      .finally(() => { if (!cancelled) setImageLoading(false); });
    return () => { cancelled = true; };
  }, [violation.imagePath, violation.id, skinEnabled]);

  return { imageData, imageLoading };
}
