import { useRef, useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";
import { Button } from "@/components/ui/button";

interface Step2PositionProps {
  onNext: () => void;
  onBack: () => void;
}

export function Step2Position({ onNext, onBack }: Step2PositionProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStream = useAppStore((s) => s.cameraStream);

  // Attach the always-alive stream from GlobalWebcam — identical pattern to LiveCamera.tsx
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Position the flash so it is clearly visible in the camera view below. When the flash is
        in frame and ready, click <span className="font-medium text-foreground">Flash is in position</span>.
      </p>

      {/* Live camera feed */}
      <div className="relative overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: "16 / 9" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Overlay crosshair hint */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-20 h-20 opacity-60">
            {/* Horizontal line */}
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white -translate-y-px" />
            {/* Vertical line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white -translate-x-px" />
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white rounded-tl" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white rounded-tr" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white rounded-bl" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white rounded-br" />
          </div>
        </div>

        {/* No-stream fallback */}
        {!cameraStream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No camera feed</p>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Aim the flash at the camera lens or a white surface in the camera&apos;s field of view
      </p>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onBack} className="flex-1">
          ← Back
        </Button>
        <Button onClick={onNext} disabled={!cameraStream} className="flex-1">
          Flash is in position →
        </Button>
      </div>
    </div>
  );
}
