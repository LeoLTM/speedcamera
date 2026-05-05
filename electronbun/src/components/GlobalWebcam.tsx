import { useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";

/**
 * Acquires the camera MediaStream once and stores it in the app store.
 * Renders nothing — no <video> element, no compositing, no continuous
 * frame decode.
 *
 * Previously this used react-webcam which rendered an always-playing 1280×720
 * <video> element (visibility: hidden). Even off-screen, Chromium still
 * software-decodes every frame at ~30 fps on a single CPU thread, pinning one
 * core at 100%.  By calling getUserMedia() directly the OS driver still
 * produces compressed frames, but the renderer only decodes them on-demand
 * when ImageCapture.grabFrame() is explicitly called.
 */
export function GlobalWebcam() {
  const setCameraStream = useAppStore((s) => s.setCameraStream);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        setCameraStream(s);
      })
      .catch((err) => {
        console.error("[GlobalWebcam] Camera access error:", err);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once — acquiring a new stream on every render would be wrong

  return null;
}
