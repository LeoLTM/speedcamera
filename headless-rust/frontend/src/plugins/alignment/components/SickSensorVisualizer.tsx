import { useAlignmentStore } from "../store";
import { Volume2, VolumeX, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SickSensorVisualizerProps {
  compact?: boolean;
}

export function SickSensorVisualizer({ compact = false }: SickSensorVisualizerProps) {
  const {
    sensor1Interrupted,
    sensor2Interrupted,
    sensor1Flutter,
    sensor2Flutter,
    audioFeedbackEnabled,
    toggleAudio,
  } = useAlignmentStore();

  const isS1Aligned = !sensor1Interrupted && !sensor1Flutter;
  const isS2Aligned = !sensor2Interrupted && !sensor2Flutter;
  const bothAligned = isS1Aligned && isS2Aligned;

  const renderSensorPuck = (
    label: string,
    role: string,
    pin: string,
    isInterrupted: boolean,
    isFlutter: boolean
  ) => {
    const isAligned = !isInterrupted && !isFlutter;

    return (
      <div
        className={cn(
          "flex-1 flex flex-col justify-between rounded-xl border p-2.5 sm:p-3.5 transition-all duration-200 shadow-xs",
          isAligned
            ? "border-emerald-500/50 bg-emerald-950/20 text-emerald-300 dark:bg-emerald-950/30"
            : isFlutter
            ? "border-amber-500/60 bg-amber-950/20 text-amber-300 dark:bg-amber-950/30"
            : "border-red-500/50 bg-red-950/20 text-red-300 dark:bg-red-950/30"
        )}
      >
        {/* Sensor Header Row */}
        <div className="flex items-center justify-between border-b border-border/30 pb-1.5 mb-2">
          <div>
            <div className="text-xs font-bold font-mono tracking-wider text-foreground">
              {label}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">{role}</div>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background/60 border border-border/50 text-muted-foreground">
            {pin}
          </span>
        </div>

        {/* Clustered Optical Beacon Puck */}
        <div className="flex flex-col items-center justify-center my-1">
          <div className="relative flex items-center justify-center size-12 sm:size-14 rounded-full bg-neutral-900 border-2 border-neutral-700 shadow-inner">
            {/* Glowing Aperture Ring */}
            <div
              className={cn(
                "size-6 sm:size-7 rounded-full transition-all duration-150",
                isAligned
                  ? "bg-emerald-500 shadow-[0_0_14px_#10b981]"
                  : isFlutter
                  ? "bg-amber-500 animate-ping shadow-[0_0_14px_#f59e0b]"
                  : "bg-neutral-800 border border-neutral-700"
              )}
            />
            {/* Center LED Dot */}
            <div
              className={cn(
                "absolute size-2.5 sm:size-3 rounded-full",
                isAligned
                  ? "bg-orange-500 shadow-[0_0_6px_#ea580c]"
                  : isFlutter
                  ? "bg-orange-500 animate-pulse shadow-[0_0_8px_#ea580c]"
                  : "bg-neutral-950"
              )}
            />
          </div>

          {/* State Badge */}
          <div className="mt-2 text-center">
            {isAligned ? (
              <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                <span>ALIGNED</span>
              </span>
            ) : isFlutter ? (
              <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold text-amber-400">
                <AlertTriangle className="size-3.5" />
                <span>FLUTTER</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold text-red-400">
                <XCircle className="size-3.5" />
                <span>BLOCKED</span>
              </span>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {isAligned ? "Beam locked" : isFlutter ? "Adjust angle" : "No signal"}
            </p>
          </div>
        </div>

        {/* Optical Line Indicator */}
        <div className="w-full mt-2 pt-1.5 border-t border-border/30">
          <div className="w-full h-1.5 rounded-full overflow-hidden bg-neutral-900">
            <div
              className={cn(
                "h-full w-full transition-all duration-150",
                isAligned
                  ? "bg-emerald-500 shadow-[0_0_6px_#10b981]"
                  : isFlutter
                  ? "bg-amber-500 animate-pulse"
                  : "bg-red-500/30"
              )}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* Overview Status Bar with Audio Assist */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs font-mono",
          bothAligned
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            : "border-amber-500/40 bg-amber-500/10 text-amber-400"
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2.5 rounded-full shrink-0",
              bothAligned
                ? "bg-emerald-500 animate-pulse shadow-[0_0_6px_#10b981]"
                : "bg-amber-500"
            )}
          />
          <span className="font-semibold text-xs truncate">
            {bothAligned ? "Dual Barriers Locked" : "Alignment Incomplete"}
          </span>
        </div>

        {/* Audio assist toggle */}
        <button
          type="button"
          onClick={toggleAudio}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-sans transition-colors border shrink-0",
            audioFeedbackEnabled
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background/80 text-muted-foreground border-border hover:text-foreground"
          )}
          title="Audio assist for hands-free roadside alignment"
        >
          {audioFeedbackEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          <span className="text-[10px] font-medium">
            {audioFeedbackEnabled ? "Audio On" : "Audio Assist"}
          </span>
        </button>
      </div>

      {/* Side-by-side Dual Light Barrier Assembly — ALWAYS horizontal grid */}
      <div className="relative">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full">
          {renderSensorPuck("Sensor 1", "Entry (S1)", "GPIO 16", sensor1Interrupted, sensor1Flutter)}
          {renderSensorPuck("Sensor 2", "Exit (S2)", "GPIO 12", sensor2Interrupted, sensor2Flutter)}
        </div>

        {/* Physical 135 mm Spacing Badge in Center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 hidden xs:flex items-center justify-center">
          <span className="bg-background/95 border border-border/80 px-2 py-0.5 rounded-full text-[9px] font-mono text-muted-foreground shadow-xs">
            135 mm
          </span>
        </div>
      </div>
    </div>
  );
}
