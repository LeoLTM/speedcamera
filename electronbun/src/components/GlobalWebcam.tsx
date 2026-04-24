import { useRef, useEffect } from "react";
import Webcam from "react-webcam";
import { useAppStore } from "@/stores/useAppStore";

/**
 * Always-mounted, invisible webcam instance.
 * Rendered once at the root level so the camera stream is never torn down
 * during navigation. Exposes the ref and live MediaStream via the store.
 */
export function GlobalWebcam() {
  const webcamRef = useRef<Webcam | null>(null);
  const setWebcamRef = useAppStore((s) => s.setWebcamRef);
  const setCameraStream = useAppStore((s) => s.setCameraStream);

  useEffect(() => {
    setWebcamRef(webcamRef);
    return () => {
      setWebcamRef(null);
      setCameraStream(null);
    };
  }, [setWebcamRef, setCameraStream]);

  return (
    <Webcam
      ref={webcamRef}
      audio={false}
      screenshotFormat="image/png"
      videoConstraints={{}}
      style={{
        position: "fixed",
        // Off-screen but with real rendered dimensions so react-webcam's
        // getScreenshot() captures at full resolution (it uses clientWidth/Height).
        left: "-9999px",
        top: "-9999px",
        width: "1280px",
        height: "720px",
        visibility: "hidden",
        pointerEvents: "none",
      }}
      mirrored={false}
      onUserMedia={(stream) => setCameraStream(stream)}
      onUserMediaError={(err) =>
        console.error("[GlobalWebcam] Camera access error:", err)
      }
    />
  );
}
