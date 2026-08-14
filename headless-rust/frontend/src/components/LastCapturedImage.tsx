import { useEffect, useState } from "react";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import { Image as ImageIcon } from "lucide-react";

export function LastCapturedImage() {
  const lastViolation = useAppStore((s) => s.lastViolation);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    if (lastViolation) {
      getRpc().request.getImageData({ imagePath: lastViolation.imagePath }).then(setImageSrc).catch(() => setImageSrc(null));
    } else {
      setImageSrc(null);
    }
  }, [lastViolation]);

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      {imageSrc ? (
        <img
          src={imageSrc}
          alt="Last capture"
          className="max-w-full max-h-full object-contain animate-in fade-in duration-500"
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
  );
}
