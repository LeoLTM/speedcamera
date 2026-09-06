import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { useLapStore } from "../store";
import { useLiveLapTimer } from "../hooks/useLiveLapTimer";
import type { Lap } from "@/shared/types";

function formatDurationParts(ms: number) {
  const total = Math.round(ms);
  const totalSeconds = Math.floor(total / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = total % 1000;
  return {
    main: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    millis: `.${String(millis).padStart(3, "0")}`,
  };
}

export interface LapTimerDisplayProps {
  compact?: boolean;
  laps?: Lap[];
  className?: string;
}

export function LapTimerDisplay({ compact = false, laps = [], className }: LapTimerDisplayProps) {
  const lapState = useLapStore((s) => s.lapState);
  const lapNumber = useLapStore((s) => s.lapNumber);
  const elapsed = useLiveLapTimer();

  const bestLap = laps.length > 0
    ? laps.reduce((b, l) => l.durationMs < b.durationMs ? l : b)
    : null;
  const lastLap = laps.length > 0 ? laps[laps.length - 1] : null;

  const isTiming = lapState === "timing" && elapsed !== null;
  const isWaiting = lapState === "waiting";

  const parts = isTiming ? formatDurationParts(elapsed!) : null;

  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 select-none", className)}>
      {/* State label */}
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-[0.2em]",
          isTiming
            ? "text-green-500 dark:text-green-400"
            : isWaiting
            ? "text-yellow-500 dark:text-yellow-400"
            : "text-muted-foreground",
        )}
      >
        {isTiming
          ? `Lap ${lapNumber}`
          : isWaiting
          ? "Waiting for car…"
          : "Idle"}
      </p>

      {/* Big timer */}
      <div
        className={cn(
          "font-mono font-black tabular-nums leading-none tracking-tight",
          compact ? "text-4xl sm:text-5xl" : "text-5xl sm:text-7xl md:text-8xl",
          isTiming
            ? "text-foreground"
            : "text-muted-foreground/30",
        )}
      >
        {isTiming && parts ? (
          <>
            <span>{parts.main}</span>
            <span
              className={cn(
                "font-mono font-bold",
                compact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl md:text-5xl",
                "text-muted-foreground",
              )}
            >
              {parts.millis}
            </span>
          </>
        ) : (
          <span>{isWaiting ? "—" : "00:00"}<span className={cn("font-bold", compact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl md:text-5xl", "text-muted-foreground/30")}>.000</span></span>
        )}
      </div>

      {/* Comparison row */}
      {laps.length > 0 && (
        <div className={cn("flex items-center gap-4 mt-1", compact ? "text-xs" : "text-sm")}>
          {lastLap && (
            <span className="text-muted-foreground">
              Last:{" "}
              <span className="font-mono font-semibold text-foreground">
                {formatDuration(lastLap.durationMs)}
              </span>
            </span>
          )}
          {bestLap && (
            <span className="text-muted-foreground">
              Best:{" "}
              <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                {formatDuration(bestLap.durationMs)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
