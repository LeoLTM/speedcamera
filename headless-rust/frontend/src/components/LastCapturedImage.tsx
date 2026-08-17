import { useEffect, useState } from "react";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Image as ImageIcon } from "lucide-react";

export function LastCapturedImage() {
  const lastViolation = useAppStore((s) => s.lastViolation);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const loadImage = (imagePath: string) => {
    // ponytail: 800px preview for dashboard view saves Wi-Fi payload
    getRpc()
      .request.getImageData({ imagePath, width: 800, quality: 80 })
      .then((src) => {
        setImageSrc(`${src}&_t=${Date.now()}`);
      })
      .catch(() => setImageSrc(null));
  };

  useEffect(() => {
    if (lastViolation && lastViolation.imagePath) {
      loadImage(lastViolation.imagePath);
    } else {
      setImageSrc(null);
    }
  }, [lastViolation]);

  const fullResUrl = lastViolation?.imagePath
    ? `/image?path=${encodeURIComponent(lastViolation.imagePath)}`
    : null;

  return (
    <>
      <div
        className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden cursor-pointer"
        onClick={() => imageSrc && setLightboxOpen(true)}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt="Last capture"
            className="max-w-full max-h-full object-contain animate-in fade-in duration-500 hover:scale-[1.01] transition-transform"
          />
      ) : (
        <div className="flex flex-col items-center text-muted-foreground/50">
          <ImageIcon className="w-16 h-16 mb-4 opacity-50" />
          <p className="font-mono text-sm tracking-wider uppercase">Awaiting Capture</p>
        </div>
      )}

      {lastViolation && (
        <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1.5 rounded border border-border shadow-lg flex items-center gap-3">
          <span className="font-mono text-sm text-muted-foreground">
            {new Date(lastViolation.timestamp).toLocaleTimeString()}
          </span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold text-destructive">
              {lastViolation.measuredSpeed}
            </span>
            <span className="font-mono text-xs text-muted-foreground">km/h</span>
          </div>
        </div>
      )}
    </div>

    <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
      <DialogContent
        className="max-w-[96vw] sm:max-w-[96vw] w-[96vw] sm:w-[96vw] h-[96vh] sm:h-[96vh] max-h-[96vh] sm:max-h-[96vh] p-0 rounded-none bg-black/95 border-none flex items-center justify-center overflow-hidden"
        showCloseButton
      >
        {fullResUrl && (
          <img
            src={fullResUrl}
            alt="Last capture full resolution"
            className="w-full h-full object-contain rounded-none"
          />
        )}
      </DialogContent>
    </Dialog>
  </>
  );
}
