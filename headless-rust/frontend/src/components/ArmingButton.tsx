import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Shield01Icon,
  ShieldHalfIcon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";

const HOLD_DURATION_MS = 3000;
/** How long after a successful arm to ignore click-to-disarm (ms) */
const POST_ARM_DEBOUNCE_MS = 600;

export function ArmingButton() {
  const systemState = useAppStore((s) => s.systemState);
  const setArmed = useAppStore((s) => s.setArmed);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const cameraConnected = useAppStore((s) => s.cameraConnected);

  const [progress, setProgress] = useState(0); // 0–1
  const [isHolding, setIsHolding] = useState(false);

  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  /** Set to true right after arm completes; cleared after debounce window */
  const justArmedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startTimeRef.current = null;
    completedRef.current = false;
    setIsHolding(false);
    setProgress(0);
  }, []);

  const startHold = useCallback(() => {
    // Can only arm from DISARMED (conditions met, not yet armed)
    if (systemState !== "DISARMED") return;

    completedRef.current = false;
    startTimeRef.current = performance.now();
    setIsHolding(true);
    setProgress(0);

    const tick = (now: number) => {
      if (!startTimeRef.current) return;
      const elapsed = now - startTimeRef.current;
      const p = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setProgress(p);

      if (p >= 1 && !completedRef.current) {
        completedRef.current = true;
        setIsHolding(false);
        setProgress(0);
        // Mark debounce window so the imminent click event is ignored
        justArmedRef.current = true;
        if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          justArmedRef.current = false;
        }, POST_ARM_DEBOUNCE_MS);
        void setArmed(true);
        return;
      }

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [systemState, setArmed]);

  const handlePointerDown = useCallback(() => {
    if (systemState === "DISARMED") {
      startHold();
    }
  }, [systemState, startHold]);

  const handleClick = useCallback(() => {
    // Ignore the click that fires right after a successful hold-to-arm
    if (justArmedRef.current) return;
    if (systemState === "ARMED") {
      void setArmed(false);
    }
  }, [systemState, setArmed]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const isArmed = systemState === "ARMED";
  const isPassive = systemState === "PASSIVE";
  const isDisarmed = systemState === "DISARMED";

  // Derive which conditions are missing for the hint text
  const missingCamera = !cameraConnected;
  const missingSerial = !connectedPort;

  return (
    <div
      className={cn(
        "rounded-xl border-2 p-4 transition-all duration-300",
        isArmed
          ? "border-red-500/70 bg-red-950/20 dark:bg-red-950/30 shadow-lg shadow-red-900/20"
          : isPassive
            ? "border-border bg-card opacity-75"
            : "border-amber-500/60 bg-amber-950/10 dark:bg-amber-950/20",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={isArmed ? ShieldHalfIcon : isPassive ? Shield01Icon : ShieldKeyIcon}
            className={cn(
              "size-5 transition-colors duration-300",
              isArmed
                ? "text-red-400"
                : isPassive
                  ? "text-muted-foreground"
                  : "text-amber-400",
            )}
            strokeWidth={2}
          />
          <span
            className={cn(
              "text-xs font-semibold uppercase tracking-widest transition-colors duration-300",
              isArmed
                ? "text-red-400"
                : isPassive
                  ? "text-muted-foreground"
                  : "text-amber-400",
            )}
          >
            System
          </span>
        </div>

        {/* State pill */}
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full transition-all duration-300",
            isArmed
              ? "bg-red-500/20 text-red-400 border border-red-500/40"
              : isDisarmed
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                : "bg-muted text-muted-foreground border border-border",
          )}
        >
          {systemState}
        </span>
      </div>

      {/* Arming / disarming button */}
      <button
        type="button"
        disabled={isPassive}
        onPointerDown={handlePointerDown}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onClick={handleClick}
        className={cn(
          "relative w-full overflow-hidden rounded-lg border font-semibold text-sm",
          "h-12 select-none transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          isPassive
            ? "cursor-not-allowed border-border/40 bg-muted/20 text-muted-foreground/40"
            : isArmed
              ? [
                  "cursor-pointer border-red-500/50 bg-red-500/10 text-red-300",
                  "hover:bg-red-500/20 active:bg-red-500/30",
                  "focus-visible:ring-red-500",
                ]
              : [
                  "cursor-pointer border-border/70 bg-muted/40 text-foreground",
                  "hover:bg-muted active:bg-muted/60",
                  "focus-visible:ring-ring",
                ],
        )}
        aria-label={
          isPassive
            ? "System cannot be armed: conditions not met"
            : isArmed
              ? "Click to disarm the system"
              : "Hold for 3 seconds to arm the system"
        }
      >
        {/* Progress fill — left to right */}
        {isHolding && (
          <span
            className="absolute inset-0 bg-amber-500/25 pointer-events-none"
            style={{ transform: `scaleX(${progress})`, transformOrigin: "left" }}
            aria-hidden="true"
          />
        )}

        {/* Label */}
        <span className="relative z-10 flex items-center justify-center gap-2 px-4">
          <HugeiconsIcon
            icon={isArmed ? ShieldHalfIcon : Shield01Icon}
            className="size-4 shrink-0"
            strokeWidth={2}
          />
          {isArmed ? (
            <span>Click to Disarm</span>
          ) : isHolding ? (
            <span>Hold to arm… {Math.round(progress * 100)}%</span>
          ) : (
            <span>Hold 3s to Arm</span>
          )}
        </span>
      </button>

      {/* Hint */}
      <p className="mt-2 text-center text-[10px] text-muted-foreground/60 leading-tight">
        {isArmed
          ? "Violations are being recorded"
          : isDisarmed
            ? "Monitoring only — no violations recorded"
            : [missingCamera && "camera", missingSerial && "serial connection"]
                .filter(Boolean)
                .join(" & ") + " required"}
      </p>
    </div>
  );
}
