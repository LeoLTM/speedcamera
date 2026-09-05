import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, StopIcon, Timer01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LapTimerDisplay } from "../components/LapTimerDisplay";
import { useLapStore, type LapState } from "../store";
import { useAppStore } from "@/stores/useAppStore";
import { LapRow } from "./LapRow";
import type { Lap } from "@/shared/types";

const LAP_TABLE_COLS = 6;

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

export function LiveSessionTab() {
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
  const bestLapId = currentLaps.length > 0
    ? currentLaps.reduce((best, lap) => lap.durationMs < best.durationMs ? lap : best).id
    : null;

  const empty = currentLaps.length === 0 && lapState === "idle" && !currentSession;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Control bar */}
      <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card">
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-semibold", stateColor[lapState])}>
              {stateLabel[lapState]}
            </span>
            {isLapSaving && (
              <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Mode: <span className="font-medium">{lapSettings.lapMode === "single" ? "Single lap" : "Multi-lap"}</span>
            {currentSession && (
              <> · Session #{currentSession.id}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {lapState === "idle" ? (
            <Button
              size="sm"
              onClick={handleStart}
              disabled={!canStart || starting}
              title={!canStart ? "Connect a serial port first" : undefined}
            >
              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
              {starting ? "Starting…" : "Start"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleStop}
              disabled={stopping}
            >
              <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>
      </div>

      {/* Laps table */}
      {empty ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <HugeiconsIcon icon={Timer01Icon} strokeWidth={1.5} className="w-12 h-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No active session. Press Start to begin.</p>
        </div>
      ) : (
        <>
          {/* Big running timer — always shown while session is active */}
          <div className="rounded-xl border border-border bg-card py-8 px-4">
            <LapTimerDisplay laps={currentLaps} />
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-12">#</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Speed In</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Speed Out</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Start</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground w-20">Images</th>
                </tr>
              </thead>
              <tbody>
                {currentLaps.length === 0 ? (
                  <tr>
                    <td colSpan={LAP_TABLE_COLS} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      {lapState === "waiting" ? "Waiting for first car to pass…" : "Timing first lap…"}
                    </td>
                  </tr>
                ) : (
                  currentLaps.map((lap) => (
                    <LapRow
                      key={lap.id}
                      lap={lap}
                      isBest={lap.id === bestLapId}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Summary */}
      {currentLaps.length > 1 && (
        <LapSummary laps={currentLaps} />
      )}
    </div>
  );
}

function LapSummary({ laps }: { laps: Lap[] }) {
  const best = laps.reduce((b, l) => l.durationMs < b.durationMs ? l : b);
  const worst = laps.reduce((b, l) => l.durationMs > b.durationMs ? l : b);
  const avg = laps.reduce((sum, l) => sum + l.durationMs, 0) / laps.length;

  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: "Best", value: formatDuration(best.durationMs), color: "text-green-600 dark:text-green-400" },
        { label: "Average", value: formatDuration(Math.round(avg)), color: "" },
        { label: "Worst", value: formatDuration(worst.durationMs), color: "text-red-500 dark:text-red-400" },
      ].map(({ label, value, color }) => (
        <div
          key={label}
          className="rounded-xl border border-border bg-card p-3 text-center space-y-0.5"
        >
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{label}</p>
          <p className={cn("font-mono text-lg font-semibold tabular-nums", color)}>{value}</p>
        </div>
      ))}
    </div>
  );
}
