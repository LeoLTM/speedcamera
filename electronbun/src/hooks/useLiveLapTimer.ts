import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";

/**
 * Returns the elapsed milliseconds for the current lap being timed,
 * updated every 50 ms. Returns null when not actively timing.
 */
export function useLiveLapTimer(): number | null {
  const lapState = useAppStore((s) => s.lapState);
  const startEvent = useAppStore((s) => s.startEvent);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (lapState !== "timing" || !startEvent) {
      setElapsed(null);
      return;
    }
    // Tick immediately, then every 50 ms
    setElapsed(Date.now() - startEvent.timestamp);
    const id = setInterval(() => {
      setElapsed(Date.now() - startEvent.timestamp);
    }, 50);
    return () => clearInterval(id);
  }, [lapState, startEvent]);

  return elapsed;
}
