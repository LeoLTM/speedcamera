import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getRpc } from "@/lib/rpc";

interface LapImageThumbnailsProps {
  startImagePath: string | null;
  endImagePath: string | null;
  /** Optional extra node rendered after the thumbnails (e.g. a delete button). */
  trailing?: React.ReactNode;
}

/**
 * Renders start/end lap capture thumbnails with a shared lightbox.
 * Fetches image data lazily via the RPC and cancels pending fetches on unmount.
 */
export function LapImageThumbnails({
  startImagePath,
  endImagePath,
  trailing,
}: LapImageThumbnailsProps) {
  const [startImageUrl, setStartImageUrl] = useState<string | null>(null);
  const [endImageUrl, setEndImageUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStartImageUrl(null);
    setEndImageUrl(null);
    if (startImagePath) {
      getRpc()
        .request.getImageData({ imagePath: startImagePath })
        .then((data) => { if (!cancelled) setStartImageUrl(data); })
        .catch(() => {});
    }
    if (endImagePath) {
      getRpc()
        .request.getImageData({ imagePath: endImagePath })
        .then((data) => { if (!cancelled) setEndImageUrl(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [startImagePath, endImagePath]);

  return (
    <>
      <div className="flex items-center justify-center gap-1">
        {(startImageUrl || endImageUrl) ? (
          <>
            {startImageUrl && (
              <button
                type="button"
                onClick={() => setLightboxUrl(startImageUrl)}
                className="w-8 h-6 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                title="Start image"
              >
                <img src={startImageUrl} alt="start" className="w-full h-full object-cover" />
              </button>
            )}
            {endImageUrl && (
              <button
                type="button"
                onClick={() => setLightboxUrl(endImageUrl)}
                className="w-8 h-6 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                title="End image"
              >
                <img src={endImageUrl} alt="end" className="w-full h-full object-cover" />
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
        {trailing}
      </div>

      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent
          className="max-w-[96vw] sm:max-w-[96vw] w-[96vw] sm:w-[96vw] h-[96vh] sm:h-[96vh] max-h-[96vh] sm:max-h-[96vh] p-0 rounded-none bg-black/95 border-none flex items-center justify-center overflow-hidden"
          showCloseButton
        >
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Lap capture"
              className="w-full h-full object-contain rounded-none"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
