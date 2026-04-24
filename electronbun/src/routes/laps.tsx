import { useState, useEffect, useCallback } from "react";
import { createRoute } from "@tanstack/react-router";
import { Tabs as TabsPrimitive } from "radix-ui";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  StopIcon,
  Delete02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Timer01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LapTimerDisplay } from "@/components/LapTimerDisplay";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";
import type { Lap, LapSessionWithLaps } from "@/shared/types";

export const LapsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/laps",
  component: LapsPage,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

function LapsPage() {
  return (
    <div className="h-full overflow-hidden flex flex-col">
      <TabsPrimitive.Root defaultValue="live" className="flex flex-col h-full">
        <TabsPrimitive.List className="flex shrink-0 border-b border-border px-4 gap-0.5">
          {(["live", "history"] as const).map((tab) => (
            <TabsPrimitive.Trigger
              key={tab}
              value={tab}
              className={cn(
                "px-4 py-2.5 text-sm font-medium text-muted-foreground",
                "border-b-2 border-transparent -mb-px transition-colors",
                "hover:text-foreground",
                "data-[state=active]:text-foreground data-[state=active]:border-primary",
              )}
            >
              {tab === "live" ? "Live Session" : "History"}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        <TabsPrimitive.Content value="live" className="flex-1 overflow-y-auto p-4">
          <LiveSessionTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="history" className="flex-1 overflow-y-auto p-4">
          <HistoryTab />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}

// ─── Live Session Tab ─────────────────────────────────────────────────────────

function LiveSessionTab() {
  const lapState = useAppStore((s) => s.lapState);
  const currentSession = useAppStore((s) => s.currentSession);
  const currentLaps = useAppStore((s) => s.currentLaps);
  const lapSettings = useAppStore((s) => s.lapSettings);
  const isLapSaving = useAppStore((s) => s.isLapSaving);
  const startLapSession = useAppStore((s) => s.startLapSession);
  const stopLapSession = useAppStore((s) => s.stopLapSession);
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

  const stateLabel: Record<typeof lapState, string> = {
    idle: "Idle",
    waiting: "Waiting for car…",
    timing: "Timing…",
  };

  const stateColor: Record<typeof lapState, string> = {
    idle: "text-muted-foreground",
    waiting: "text-yellow-500 dark:text-yellow-400",
    timing: "text-green-500 dark:text-green-400",
  };

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
      {currentLaps.length === 0 && lapState === "idle" && !currentSession ? (
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
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
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

// ─── Lap Row ──────────────────────────────────────────────────────────────────

interface LapRowProps {
  lap: Lap;
  isBest: boolean;
}

function LapRow({ lap, isBest }: LapRowProps) {
  const [startImageUrl, setStartImageUrl] = useState<string | null>(null);
  const [endImageUrl, setEndImageUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (lap.startImagePath) {
      getRpc()
        .request.getImageData({ imagePath: lap.startImagePath })
        .then((data) => { if (!cancelled) setStartImageUrl(data); })
        .catch(() => {});
    }
    if (lap.endImagePath) {
      getRpc()
        .request.getImageData({ imagePath: lap.endImagePath })
        .then((data) => { if (!cancelled) setEndImageUrl(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [lap.startImagePath, lap.endImagePath]);

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 last:border-0 transition-colors hover:bg-muted/30",
          isBest && "bg-green-500/5",
        )}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-medium">{lap.lapNumber}</span>
            {isBest && (
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                strokeWidth={2}
                className="w-3.5 h-3.5 text-green-500 dark:text-green-400"
              />
            )}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span
            className={cn(
              "font-mono text-sm",
              isBest ? "text-green-600 dark:text-green-400 font-semibold" : "",
            )}
          >
            {formatDuration(lap.durationMs)}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
          {lap.speedAtStart} <span className="text-xs">km/h</span>
        </td>
        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
          {lap.speedAtEnd} <span className="text-xs">km/h</span>
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
          {formatTimestamp(lap.startTimestamp)}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-center gap-1">
            {(startImageUrl || endImageUrl) ? (
              <>
                {startImageUrl && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(startImageUrl)}
                    className="w-8 h-6 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                    title="Start image"
                  >
                    <img src={startImageUrl} alt="start" className="w-full h-full object-cover" />
                  </button>
                )}
                {endImageUrl && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(endImageUrl)}
                    className="w-8 h-6 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                    title="End image"
                  >
                    <img src={endImageUrl} alt="end" className="w-full h-full object-cover" />
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground/40">—</span>
            )}
          </div>
        </td>
      </tr>
      {/* Lightbox */}
      {lightboxUrl && (
        <tr>
          <td colSpan={6} className="p-0">
            <button
              type="button"
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
              onClick={() => setLightboxUrl(null)}
            >
              <img
                src={lightboxUrl}
                alt="Lap capture"
                className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl"
              />
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Lap Summary ──────────────────────────────────────────────────────────────

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

// ─── History Tab ──────────────────────────────────────────────────────────────

const HISTORY_PAGE_SIZE = 10;

function HistoryTab() {
  const lapHistory = useAppStore((s) => s.lapHistory);
  const fetchLapHistory = useAppStore((s) => s.fetchLapHistory);
  const deleteHistorySession = useAppStore((s) => s.deleteHistorySession);

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(lapHistory.total / HISTORY_PAGE_SIZE));

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      await fetchLapHistory(p, HISTORY_PAGE_SIZE);
    } catch {
      toast.error("Failed to load lap history");
    } finally {
      setLoading(false);
    }
  }, [fetchLapHistory]);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const handleDeleteSession = async (id: number) => {
    if (!confirm("Delete this session and all its laps?")) return;
    setDeletingId(id);
    try {
      await deleteHistorySession(id);
      if (page > 1 && lapHistory.sessions.length === 1) {
        setPage((p) => p - 1);
      }
      toast.success("Session deleted");
    } catch {
      toast.error("Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (lapHistory.sessions.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="w-12 h-12 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No past sessions found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      {lapHistory.sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          deleting={deletingId === session.id}
          onDelete={() => handleDeleteSession(session.id)}
        />
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────

interface SessionCardProps {
  session: LapSessionWithLaps;
  deleting: boolean;
  onDelete: () => void;
}

function SessionCard({ session, deleting, onDelete }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);

  const lapCount = session.laps.length;
  const bestLap = lapCount > 0
    ? session.laps.reduce((b, l) => l.durationMs < b.durationMs ? l : b)
    : null;

  const duration = session.endedAt
    ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
    : null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <HugeiconsIcon
            icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
            strokeWidth={2}
            className="w-4 h-4 text-muted-foreground shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">
                {formatSessionDate(session.startedAt)}
              </span>
              <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted capitalize">
                {session.lapMode}
              </span>
              {!session.endedAt && (
                <span className="text-xs text-yellow-500 dark:text-yellow-400 px-1.5 py-0.5 rounded bg-yellow-500/10">
                  Active
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              <span>{lapCount} lap{lapCount !== 1 ? "s" : ""}</span>
              {bestLap && (
                <span>
                  Best: <span className="font-mono text-green-600 dark:text-green-400">{formatDuration(bestLap.durationMs)}</span>
                </span>
              )}
              {duration !== null && (
                <span>Total: {formatDuration(duration)}</span>
              )}
            </div>
          </div>
        </button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={deleting}
          aria-label="Delete session"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="w-4 h-4" />
        </Button>
      </div>

      {/* Expanded laps */}
      {expanded && (
        <div className="border-t border-border">
          {lapCount === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No laps recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground w-10">#</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Speed In</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Speed Out</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground w-20">Images</th>
                </tr>
              </thead>
              <tbody>
                {session.laps.map((lap) => (
                  <HistoryLapRow
                    key={lap.id}
                    lap={lap}
                    isBest={bestLap?.id === lap.id}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── History Lap Row ──────────────────────────────────────────────────────────

function HistoryLapRow({ lap, isBest }: { lap: Lap; isBest: boolean }) {
  const deleteHistoryLap = useAppStore((s) => s.deleteHistoryLap);
  const [startImageUrl, setStartImageUrl] = useState<string | null>(null);
  const [endImageUrl, setEndImageUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (lap.startImagePath) {
      getRpc()
        .request.getImageData({ imagePath: lap.startImagePath })
        .then((data) => { if (!cancelled) setStartImageUrl(data); })
        .catch(() => {});
    }
    if (lap.endImagePath) {
      getRpc()
        .request.getImageData({ imagePath: lap.endImagePath })
        .then((data) => { if (!cancelled) setEndImageUrl(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [lap.startImagePath, lap.endImagePath]);

  const handleDelete = async () => {
    if (!confirm("Delete this lap?")) return;
    setDeleting(true);
    try {
      await deleteHistoryLap(lap.id);
    } catch {
      toast.error("Failed to delete lap");
      setDeleting(false);
    }
  };

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 last:border-0 group hover:bg-muted/30 transition-colors",
          isBest && "bg-green-500/5",
        )}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <span className="font-mono">{lap.lapNumber}</span>
            {isBest && (
              <HugeiconsIcon icon={CheckmarkCircle01Icon} strokeWidth={2} className="w-3 h-3 text-green-500" />
            )}
          </div>
        </td>
        <td className="px-4 py-2">
          <span className={cn("font-mono text-sm", isBest && "text-green-600 dark:text-green-400 font-semibold")}>
            {formatDuration(lap.durationMs)}
          </span>
        </td>
        <td className="px-4 py-2 text-right font-mono text-muted-foreground">
          {lap.speedAtStart} <span className="text-xs">km/h</span>
        </td>
        <td className="px-4 py-2 text-right font-mono text-muted-foreground">
          {lap.speedAtEnd} <span className="text-xs">km/h</span>
        </td>
        <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">
          {formatTimestamp(lap.startTimestamp)}
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center justify-center gap-1">
            {(startImageUrl || endImageUrl) ? (
              <>
                {startImageUrl && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(startImageUrl)}
                    className="w-8 h-6 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                    title="Start image"
                  >
                    <img src={startImageUrl} alt="start" className="w-full h-full object-cover" />
                  </button>
                )}
                {endImageUrl && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(endImageUrl)}
                    className="w-8 h-6 rounded overflow-hidden border border-border hover:border-primary transition-colors"
                    title="End image"
                  >
                    <img src={endImageUrl} alt="end" className="w-full h-full object-cover" />
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground/40">—</span>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              title="Delete lap"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {lightboxUrl && (
        <tr>
          <td colSpan={6} className="p-0">
            <button
              type="button"
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
              onClick={() => setLightboxUrl(null)}
            >
              <img
                src={lightboxUrl}
                alt="Lap capture"
                className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl"
              />
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
