import { useRef, useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";

interface LiveCameraProps {
  className?: string;
  /** Override aspect-ratio (default: 16/9 via CSS) */
  aspectRatio?: string;
}

export function LiveCamera({ className, aspectRatio = "16 / 9" }: LiveCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStream = useAppStore((s) => s.cameraStream);

  // Attach the always-alive stream from GlobalWebcam to the video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg bg-muted", className)}
      style={{ aspectRatio }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
  );
}
