import { useRef, useEffect } from "react";
import Webcam from "react-webcam";
import { useAppStore } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";

interface LiveCameraProps {
  className?: string;
  /** Override aspect-ratio (default: 16/9 via CSS) */
  aspectRatio?: string;
}

export function LiveCamera({ className, aspectRatio = "16 / 9" }: LiveCameraProps) {
  const webcamRef = useRef<Webcam | null>(null);
  const selectedCameraDeviceId = useAppStore((s) => s.selectedCameraDeviceId);
  const setWebcamRef = useAppStore((s) => s.setWebcamRef);

  // Register ref in the global store so measurementSlice can capture screenshots
  useEffect(() => {
    setWebcamRef(webcamRef);
    return () => setWebcamRef(null);
  }, [setWebcamRef]);

  const videoConstraints: MediaTrackConstraints = selectedCameraDeviceId
    ? { deviceId: { exact: selectedCameraDeviceId } }
    : {};

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg bg-muted", className)}
      style={{ aspectRatio }}
    >
      <Webcam
        ref={webcamRef}
        audio={false}
        screenshotFormat="image/png"
        videoConstraints={videoConstraints}
        className="absolute inset-0 w-full h-full object-cover"
        mirrored={false}
        onUserMediaError={(err) =>
          console.error("[LiveCamera] Camera access error:", err)
        }
      />
    </div>
  );
}
