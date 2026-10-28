import { cn } from "@/lib/utils";
import type { LapCrossing, LapVerdict } from "@/shared/types";
import { useLapStore } from "../store";

const VERDICT_LABEL: Record<LapVerdict, string> = {
  ACCEPTED: "Counted",
  ACCEPTED_UNVERIFIED: "Counted (kart position not checked)",
  REJECTED_FAR: "Ignored: kart not at the barrier",
  REJECTED_SLOW: "Ignored: too slow",
  REJECTED_DUPLICATE: "Ignored: double trigger",
  REJECTED_KART_OFFLINE: "Ignored: kart offline",
  REJECTED_DIRECTION: "Ignored: wrong direction",
};

const SHOWN = 8;

/** The session's latest barrier crossings with the lap engine's verdict, newest first. */
export function RecentCrossings() {
  const crossings = useLapStore((s) => s.currentCrossings);
  if (crossings.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="px-3.5 py-2 border-b border-border bg-muted/30">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Barrier Crossings ({crossings.length})
        </span>
      </div>
      <ul className="divide-y divide-border/50 text-xs">
        {crossings
          .slice(-SHOWN)
          .reverse()
          .map((c) => (
            <CrossingRow key={c.id} crossing={c} />
          ))}
      </ul>
    </div>
  );
}

function CrossingRow({ crossing: c }: { crossing: LapCrossing }) {
  const counted = c.verdict.startsWith("ACCEPTED");
  return (
    <li className={cn("flex items-center gap-3 px-3.5 py-1.5", !counted && "text-muted-foreground")}>
      <span className="font-mono tabular-nums">
        {new Date(c.wallUs / 1000).toLocaleTimeString([], { hour12: false })}
      </span>
      <span className="flex-1 min-w-0 truncate">{VERDICT_LABEL[c.verdict]}</span>
      <span className="font-mono tabular-nums">{c.speed.toFixed(1)} km/h</span>
      <span className="font-mono tabular-nums w-16 text-right">
        {c.distanceM === null ? "" : `${c.distanceM.toFixed(0)} m`}
      </span>
    </li>
  );
}
