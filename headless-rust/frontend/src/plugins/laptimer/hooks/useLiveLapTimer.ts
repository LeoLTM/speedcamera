import { useState, useEffect } from "react";
import { useLapStore } from "../store";

/**
 * Returns the elapsed milliseconds for the current lap being timed,
 * updated every 50 ms. Returns null when not actively timing.
 */
export function useLiveLapTimer(): number | null {
  const lapState = useLapStore((s) => s.lapState);
  const lapTimingStartedAt = useLapStore((s) => s.lapTimingStartedAt);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (lapState !== "timing" || !lapTimingStartedAt) {
      setElapsed(null);
      return;
    }
    // Tick immediately, then every 50 ms
    setElapsed(Date.now() - lapTimingStartedAt);
    const id = setInterval(() => {
      setElapsed(Date.now() - lapTimingStartedAt);
    }, 50);
    return () => clearInterval(id);
  }, [lapState, lapTimingStartedAt]);

  return elapsed;
}
