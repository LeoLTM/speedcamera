import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, StopIcon, Timer01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LapTimerDisplay } from "./LapTimerDisplay";
import { useLapStore, type LapState } from "../store";
import { useAppStore } from "@/stores/useAppStore";
import { LapRow } from "../routes/LapRow";
import type { Lap } from "@/shared/types";

const stateLabel: Record<LapState, string> = {
  idle: "Idle",
  waiting: "Waiting for car…",
  timing: "Timing…",
};

const stateColor: Record<LapState, string> = {
  idle: "text-muted-foreground",
  waiting: "text-yellow-500 dark:text-yellow-400",
  timing: "text-green-500 dark:text-green-400",
};

// ponytail: complete live lap session interface integrated into Home tab
export function LapTimerSidePanel() {
  const lapState = useLapStore((s) => s.lapState);
  const currentSession = useLapStore((s) => s.currentSession);
  const currentLaps = useLapStore((s) => s.currentLaps);
  const lapSettings = useLapStore((s) => s.lapSettings);
  const isLapSaving = useLapStore((s) => s.isLapSaving);
  const startLapSession = useLapStore((s) => s.startLapSession);
  const stopLapSession = useLapStore((s) => s.stopLapSession);
  const connectedPort = useAppStore((s) => s.connectedPort);

  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const canStart = !!connectedPort;

  const handleStart = async () => {
    setStarting(true);
    try {
      await startLapSession();
    } catch {
      toast.error("Failed to start lap session");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopLapSession();
    } catch {
      toast.error("Failed to stop lap session");
    } finally {
      setStopping(false);
    }
  };

  // Find best lap (shortest duration)
  const bestLapId =
    currentLaps.length > 0
      ? currentLaps.reduce((best, lap) => (lap.durationMs < best.durationMs ? lap : best)).id
      : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Session Control Bar */}
      <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-border bg-card shadow-sm">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-bold uppercase tracking-wider", stateColor[lapState])}>
              {stateLabel[lapState]}
            </span>
            {isLapSaving && (
              <span className="text-[11px] text-muted-foreground animate-pulse">Saving…</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            Mode: <span className="font-medium">{lapSettings.lapMode === "single" ? "Single lap" : "Multi-lap"}</span>
            {currentSession && <> · Session #{currentSession.id}</>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lapState === "idle" ? (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={!canStart || starting}
              title={!canStart ? "Connect a serial port first" : undefined}
              className="h-8 px-3 text-xs font-semibold"
            >
              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="w-3.5 h-3.5 mr-1" />
              {starting ? "Starting…" : "Start Session"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleStop}
              disabled={stopping}
              className="h-8 px-3 text-xs font-semibold"
            >
              <HugeiconsIcon icon={StopIcon} strokeWidth={2} className="w-3.5 h-3.5 mr-1" />
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>
      </div>

      {/* Big Digital Stopwatch */}
      <div className="rounded-xl border border-border bg-card py-6 px-4 shadow-sm">
        <LapTimerDisplay compact={false} laps={currentLaps} />
      </div>

      {/* Summary Stats (when multiple laps) */}
      {currentLaps.length > 1 && <LapSummary laps={currentLaps} />}

      {/* Live Session Laps Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="px-3.5 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Session Laps ({currentLaps.length})
          </span>
          {bestLapId && (
            <span className="text-[11px] font-mono text-green-600 dark:text-green-400 font-semibold">
              Best: {formatDuration(currentLaps.find((l) => l.id === bestLapId)!.durationMs)}
            </span>
          )}
        </div>

        {currentLaps.length === 0 ? (
          <div className="py-8 px-4 text-center">
            {lapState === "idle" ? (
              <div className="flex flex-col items-center gap-2">
                <HugeiconsIcon icon={Timer01Icon} strokeWidth={1.5} className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No active session. Click Start Session to begin.</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground animate-pulse">
                {lapState === "waiting" ? "Waiting for first car to trigger sensor…" : "Timing in progress…"}
              </p>
            )}
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20 text-muted-foreground font-medium">
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">Duration</th>
                  <th className="px-3 py-2 text-right">In</th>
                  <th className="px-3 py-2 text-right">Out</th>
                  <th className="px-3 py-2 text-right">Time</th>
                  <th className="px-3 py-2 text-center w-20">Images</th>
                </tr>
              </thead>
              <tbody>
                {currentLaps.map((lap) => (
                  <LapRow
                    key={lap.id}
                    lap={lap}
                    isBest={lap.id === bestLapId}
                    deletable
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LapSummary({ laps }: { laps: Lap[] }) {
  const best = laps.reduce((b, l) => (l.durationMs < b.durationMs ? l : b));
  const worst = laps.reduce((b, l) => (l.durationMs > b.durationMs ? l : b));
  const avg = laps.reduce((sum, l) => sum + l.durationMs, 0) / laps.length;

  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: "Best", value: formatDuration(best.durationMs), color: "text-green-600 dark:text-green-400" },
        { label: "Average", value: formatDuration(Math.round(avg)), color: "" },
        { label: "Worst", value: formatDuration(worst.durationMs), color: "text-red-500 dark:text-red-400" },
      ].map(({ label, value, color }) => (
        <div
          key={label}
          className="rounded-xl border border-border bg-card p-2.5 text-center space-y-0.5 shadow-sm"
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</p>
          <p className={cn("font-mono text-sm font-semibold tabular-nums", color)}>{value}</p>
        </div>
      ))}
    </div>
  );
}
