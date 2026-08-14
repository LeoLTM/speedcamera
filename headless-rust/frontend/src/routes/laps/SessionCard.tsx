import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { formatDuration, formatSessionDate } from "@/lib/format";
import { LapRow } from "./LapRow";
import type { LapSessionWithLaps } from "@/shared/types";

interface SessionCardProps {
  session: LapSessionWithLaps;
  deleting: boolean;
  onDelete: () => void;
}

export function SessionCard({ session, deleting, onDelete }: SessionCardProps) {
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
                  <LapRow
                    key={lap.id}
                    lap={lap}
                    isBest={bestLap?.id === lap.id}
                    deletable
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
