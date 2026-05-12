import { useState, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { grabFrameWithRetry, bitmapToObjectUrl } from "../utils/captureUtils";
import { scoreImage } from "../utils/sweepScoring";
import type { FlashColor, CalibrationImage } from "../types";
import { cn } from "@/lib/utils";

// ─── Shared constants ─────────────────────────────────────────────────────────

/** Minimum ms between the end of one iteration and the start of the next. */
const MIN_ITER_COOLDOWN_MS = 300;

/** Tiny gray PNG used as a score-0 placeholder when a capture fails. */
const FALLBACK_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAD0lEQVQI12NgYGD4TxAGAAJYAR2hMc7wAAAAAElFTkSuQmCC";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Sweep mode configurations ────────────────────────────────────────────────

const GRID_MODES = {
  quick: {
    label: "Quick",
    description: "Coarse 4x4 grid. Fast first orientation across a wide range.",
    flashDurations: [20, 40, 80, 150] as readonly number[],
    pictureDelays: [20, 50, 100, 200] as readonly number[],
    estimatedTime: "~30 s",
  },
  fine: {
    label: "Fine Grid",
    description: "Denser 6x6 grid with tighter steps. Hits narrower sweet spots.",
    flashDurations: [20, 35, 50, 70, 100, 150] as readonly number[],
    pictureDelays: [20, 35, 50, 80, 130, 200] as readonly number[],
    estimatedTime: "~2 min",
  },
} as const;

const ADAPTIVE_CONFIG = {
  label: "Adaptive",
  description: "Multi-start hill climbing. Fewer shots, smarter targeting.",
  estimatedPhotos: "~30-50",
  estimatedTime: "~1-2 min",
  flashStep: 10,
  delayStep: 10,
  flashMin: 10,
  flashMax: 300,
  delayMin: 10,
  delayMax: 300,
  maxStepsPerSeed: 15,
  /** Starting positions spread across the interesting region of the parameter space. */
  seeds: [
    [25, 25],   [25, 120],
    [75, 50],   [75, 160],
    [150, 30],  [150, 130],
  ] as [number, number][],
};

type SweepMode = "quick" | "fine" | "adaptive";
type Phase = "idle" | "sweeping" | "done" | "error";

// ─── Thumbnail strip (must live outside Step4Sweep so React can reconcile it ──
// Defining a component inside a render function gives it a new type on every
// render, which forces React to unmount + remount the entire subtree instead of
// diffing it. During the sweep this caused O(n²) DOM churn on every iteration.

interface ThumbnailStripProps {
  images: CalibrationImage[];
}

function ThumbnailStrip({ images }: ThumbnailStripProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {images.map((img, i) => (
        <div
          key={i}
          className="relative rounded overflow-hidden bg-muted border border-border shrink-0"
          style={{ width: 56, height: 40 }}
        >
          <img src={img.objectUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
          <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] px-0.5 leading-tight">
            {(img.score * 100).toFixed(0)}%
          </div>
        </div>
      ))}
    </div>
  );
}

interface Step4SweepProps {
  flashColor: FlashColor;
  originalFlashDuration: number;
  onNext: (images: CalibrationImage[]) => void;
  onBack: () => void;
}

export function Step4Sweep({ flashColor, originalFlashDuration, onNext, onBack }: Step4SweepProps) {
  const cameraStream = useAppStore((s) => s.cameraStream);

  const [selectedMode, setSelectedMode] = useState<SweepMode>("quick");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("");
  const [images, setImages] = useState<CalibrationImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const collectedRef = useRef<CalibrationImage[]>([]);
  const abortRef = useRef(false);
  // Tracks object URLs created by this sweep so they can be revoked if the
  // component unmounts mid-sweep (e.g. dialog closed via X button).
  const localUrlsRef = useRef<string[]>([]);

  // Signal abort and revoke any orphaned URLs when the component unmounts
  useEffect(() => {
    return () => {
      abortRef.current = true;
      for (const url of localUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      localUrlsRef.current = [];
    };
  }, []);

  const handleStartSweep = useCallback(async () => {
    if (!cameraStream) return;
    setPhase("sweeping");
    setProgress(0);
    setError(null);
    setImages([]);
    collectedRef.current = [];
    abortRef.current = false;

    // ── Inner helpers (close over current cameraStream + flashColor) ───────────

    const captureOne = async (flash: number, delay: number): Promise<CalibrationImage> => {
      const iterStart = Date.now();
      try {
        await getRpc().request.sendCommand({
          json: JSON.stringify({ command: "setFlashDuration", value: flash }),
        });
        await getRpc().request.sendCommand({
          json: JSON.stringify({ command: "flash" }),
        });
        await sleep(delay);

        const bitmap = await grabFrameWithRetry(cameraStream);
        const score = scoreImage(bitmap, flashColor);
        const objectUrl = await bitmapToObjectUrl(bitmap);
        localUrlsRef.current.push(objectUrl); // track for cleanup on abort
        bitmap.close();

        const remaining = MIN_ITER_COOLDOWN_MS - (Date.now() - iterStart);
        if (remaining > 0) await sleep(remaining);

        return { flashDuration: flash, pictureDelay: delay, score, objectUrl };
      } catch {
        // Non-fatal: return a score-0 placeholder so the sweep continues
        const remaining = MIN_ITER_COOLDOWN_MS - (Date.now() - iterStart);
        if (remaining > 0) await sleep(remaining);
        return { flashDuration: flash, pictureDelay: delay, score: 0, objectUrl: FALLBACK_DATA_URL };
      }
    };

    const addEntry = (entry: CalibrationImage) => {
      collectedRef.current.push(entry);
      setProgress(collectedRef.current.length);
      setImages([...collectedRef.current]);
    };

    // ── Grid sweep ───────────────────────────────────────────────────────────

    const runGrid = async (flashDurations: readonly number[], pictureDelays: readonly number[]) => {
      for (const fd of flashDurations) {
        for (const pd of pictureDelays) {
          if (abortRef.current) return;
          setCurrentLabel(`Flash ${fd} ms · Delay ${pd} ms`);
          addEntry(await captureOne(fd, pd));
        }
      }
    };

    // ── Adaptive: multi-start hill climbing ──────────────────────────────────

    const runAdaptive = async () => {
      const {
        flashStep, delayStep, flashMin, flashMax, delayMin, delayMax, maxStepsPerSeed, seeds,
      } = ADAPTIVE_CONFIG;

      // Visited cache: prevents re-capturing when two climbing paths converge to the same point
      const visited = new Map<string, number>();
      const key = (f: number, d: number) => `${f}_${d}`;

      const evaluate = async (flash: number, delay: number): Promise<number> => {
        if (abortRef.current) return 0;
        const k = key(flash, delay);
        if (visited.has(k)) return visited.get(k)!;

        setCurrentLabel(`Flash ${flash} ms · Delay ${delay} ms`);
        const entry = await captureOne(flash, delay);
        visited.set(k, entry.score);
        addEntry(entry);
        return entry.score;
      };

      for (const [seedFlash, seedDelay] of seeds) {
        if (abortRef.current) break;

        let curFlash = seedFlash;
        let curDelay = seedDelay;
        let curScore = await evaluate(curFlash, curDelay);

        for (let step = 0; step < maxStepsPerSeed; step++) {
          if (abortRef.current) break;

          const neighbours: [number, number][] = (
            [
              [curFlash + flashStep, curDelay],
              [curFlash - flashStep, curDelay],
              [curFlash, curDelay + delayStep],
              [curFlash, curDelay - delayStep],
            ] as [number, number][]
          ).filter(([f, d]) => f >= flashMin && f <= flashMax && d >= delayMin && d <= delayMax);

          let bestScore = curScore;
          let bestNeighbour: [number, number] | null = null;

          for (const [nf, nd] of neighbours) {
            const ns = await evaluate(nf, nd);
            if (ns > bestScore) {
              bestScore = ns;
              bestNeighbour = [nf, nd];
            }
          }

          if (!bestNeighbour) break; // local maximum — done with this seed
          [curFlash, curDelay] = bestNeighbour;
          curScore = bestScore;
        }
      }
    };

    // ── Dispatch ─────────────────────────────────────────────────────────────

    let fatalErr: unknown = null;
    try {
      if (selectedMode === "adaptive") {
        await runAdaptive();
      } else {
        const cfg = GRID_MODES[selectedMode];
        await runGrid(cfg.flashDurations, cfg.pictureDelays);
      }
    } catch (err) {
      fatalErr = err;
    } finally {
      // Always restore original flashDuration — even on error / abort
      try {
        await getRpc().request.sendCommand({
          json: JSON.stringify({ command: "setFlashDuration", value: originalFlashDuration }),
        });
      } catch {
        // Best-effort; ignore if serial not connected
      }
    }

    if (fatalErr) {
      setError(fatalErr instanceof Error ? fatalErr.message : "Sweep failed");
      setPhase("error");
      return;
    }

    if (!abortRef.current) {
      setPhase("done");
    }
  }, [cameraStream, flashColor, selectedMode, originalFlashDuration]);

  const handleViewResults = useCallback(() => {
    // Parent (index.tsx) takes ownership of the URLs via objectUrlsRef.
    // Clear localUrlsRef so the unmount cleanup doesn't revoke them.
    localUrlsRef.current = [];
    onNext(collectedRef.current);
  }, [onNext]);

  // ── Derived progress values ───────────────────────────────────────────────

  const totalPhotos =
    selectedMode !== "adaptive"
      ? GRID_MODES[selectedMode].flashDurations.length *
        GRID_MODES[selectedMode].pictureDelays.length
      : null;

  // For adaptive, cap bar at 90% so it never falsely "completes" before done fires
  const pct =
    totalPhotos !== null
      ? Math.round((progress / totalPhotos) * 100)
      : Math.min(90, progress * 2);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Idle: mode selector ─────────────────────────────────────────────── */}
      {phase === "idle" && (
        <div className="space-y-3">
          {/* Mode cards */}
          <div className="grid grid-cols-3 gap-2">
            {(["quick", "fine", "adaptive"] as SweepMode[]).map((modeId) => {
              const isGrid = modeId !== "adaptive";
              const cfg = isGrid ? GRID_MODES[modeId as "quick" | "fine"] : null;
              const label = cfg ? cfg.label : ADAPTIVE_CONFIG.label;
              const description = cfg ? cfg.description : ADAPTIVE_CONFIG.description;
              const photoLabel = cfg
                ? `${cfg.flashDurations.length}×${cfg.pictureDelays.length} = ${cfg.flashDurations.length * cfg.pictureDelays.length} photos`
                : `${ADAPTIVE_CONFIG.estimatedPhotos} photos`;
              const timeLabel = cfg ? cfg.estimatedTime : ADAPTIVE_CONFIG.estimatedTime;
              const isSelected = selectedMode === modeId;

              return (
                <button
                  key={modeId}
                  onClick={() => setSelectedMode(modeId)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80 hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      isSelected ? "text-primary" : "text-foreground",
                    )}
                  >
                    {label}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {description}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    <span className="block text-[10px] font-medium text-muted-foreground">
                      {photoLabel}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">{timeLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Details panel */}
          {selectedMode !== "adaptive" ? (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Parameter Matrix
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Flash durations:</span>{" "}
                  {GRID_MODES[selectedMode].flashDurations.join(", ")} ms
                </div>
                <div>
                  <span className="font-medium text-foreground">Picture delays:</span>{" "}
                  {GRID_MODES[selectedMode].pictureDelays.join(", ")} ms
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Algorithm
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Starts from {ADAPTIVE_CONFIG.seeds.length} spread-out seed positions and climbs
                toward better scores in {ADAPTIVE_CONFIG.flashStep} ms steps. A visited cache
                prevents re-capturing the same point when paths converge.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Flash range:</span>{" "}
                  {ADAPTIVE_CONFIG.flashMin}–{ADAPTIVE_CONFIG.flashMax} ms
                </div>
                <div>
                  <span className="font-medium text-foreground">Delay range:</span>{" "}
                  {ADAPTIVE_CONFIG.delayMin}–{ADAPTIVE_CONFIG.delayMax} ms
                </div>
                <div>
                  <span className="font-medium text-foreground">Step size:</span>{" "}
                  {ADAPTIVE_CONFIG.flashStep} ms
                </div>
                <div>
                  <span className="font-medium text-foreground">Seeds:</span>{" "}
                  {ADAPTIVE_CONFIG.seeds.length}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onBack} className="flex-1">
              ← Back
            </Button>
            <Button onClick={handleStartSweep} disabled={!cameraStream} className="flex-1">
              Start Sweep
            </Button>
          </div>
        </div>
      )}

      {/* ── Sweeping ──────────────────────────────────────────────────────────── */}
      {phase === "sweeping" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="truncate pr-2">{currentLabel}</span>
              <span className="shrink-0">
                {totalPhotos !== null ? `${progress}/${totalPhotos}` : `${progress} evaluated`}
              </span>
            </div>
            <Progress value={pct} />
          </div>
          {images.length > 0 && <ThumbnailStrip images={images} />}
          <p className="text-xs text-muted-foreground text-center">
            Please wait — do not close the dialog…
          </p>
        </div>
      )}

      {/* ── Done ──────────────────────────────────────────────────────────────── */}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Sweep complete</span>
              <span>{images.length} photos</span>
            </div>
            <Progress value={100} />
          </div>
          <ThumbnailStrip images={images} />
          <Button onClick={handleViewResults} className="w-full">
            View Results →
          </Button>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────────── */}
      {phase === "error" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error ?? "Sweep failed"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack} className="flex-1">
              ← Back
            </Button>
            <Button
              onClick={() => {
                setPhase("idle");
                setError(null);
                setImages([]);
              }}
              className="flex-1"
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
