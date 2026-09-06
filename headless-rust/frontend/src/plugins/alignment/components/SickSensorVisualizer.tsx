import { useAlignmentStore } from "../store";
import { Volume2, VolumeX, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
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

  const renderSensorUnit = (
    label: string,
    pin: string,
    role: "Entry (S1)" | "Exit (S2)",
    isInterrupted: boolean,
    isFlutter: boolean
  ) => {
    // Sick status:
    // Aligned: !isInterrupted && !isFlutter -> Solid Orange LED
    // Flutter: isFlutter -> Blinking Orange LED
    // Interrupted / Missing: isInterrupted -> LED OFF
    const isAligned = !isInterrupted && !isFlutter;

    return (
      <div
        className={cn(
          "flex-1 flex flex-col items-center justify-between rounded-xl border p-4 transition-all duration-200 shadow-sm",
          isAligned
            ? "border-emerald-500/50 bg-emerald-950/10 dark:bg-emerald-950/20"
            : isFlutter
            ? "border-amber-500/60 bg-amber-950/15 dark:bg-amber-950/25"
            : "border-red-500/50 bg-red-950/15 dark:bg-red-950/25"
        )}
      >
        {/* Sensor Header */}
        <div className="w-full flex items-center justify-between border-b border-border/40 pb-2 mb-3">
          <div>
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-foreground">
              {label}
            </span>
            <span className="text-[10px] block font-mono text-muted-foreground">{role}</span>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {pin}
          </span>
        </div>

        {/* Industrial Sick Housing Graphic */}
        <div
          className={cn(
            "relative w-full max-w-[180px] bg-gradient-to-b from-neutral-800 to-neutral-900 border border-neutral-700 rounded-lg p-3 shadow-inner flex flex-col items-center",
            compact ? "my-2" : "my-4"
          )}
        >
          {/* Sick Brand Badge */}
          <div className="w-full flex items-center justify-between mb-2">
            <span className="text-[9px] font-black tracking-widest text-neutral-400">SICK</span>
            <span className="text-[8px] font-mono text-neutral-500">WL12 / OPTIC</span>
          </div>

          {/* Lens Aperture */}
          <div className="w-12 h-12 rounded-full border-2 border-neutral-600 bg-neutral-950 flex items-center justify-center relative overflow-hidden shadow-inner my-1">
            <div
              className={cn(
                "w-7 h-7 rounded-full transition-all duration-150",
                isAligned
                  ? "bg-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.9)]"
                  : isFlutter
                  ? "bg-amber-500/80 animate-ping shadow-[0_0_12px_rgba(245,158,11,0.9)]"
                  : "bg-neutral-800 border border-neutral-700"
              )}
            />
          </div>

          {/* Simulated Sick Orange Indicator LED */}
          <div className="w-full mt-3 pt-2 border-t border-neutral-800/80 flex items-center justify-between">
            <span className="text-[9px] font-mono uppercase text-neutral-400">LED Status</span>
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-3 h-3 rounded-full transition-all duration-150",
                  isAligned
                    ? "bg-orange-500 shadow-[0_0_10px_#f97316] ring-2 ring-orange-500/30"
                    : isFlutter
                    ? "bg-orange-500 animate-pulse shadow-[0_0_12px_#f97316]"
                    : "bg-neutral-800 border border-neutral-700 opacity-40"
                )}
              />
              <span className="text-[9px] font-mono font-medium text-neutral-300">
                {isAligned ? "ON" : isFlutter ? "BLINK" : "OFF"}
              </span>
            </div>
          </div>
        </div>

        {/* Optical Beam Projection Bar */}
        <div className="w-full my-2 flex items-center gap-1.5 px-1">
          <span className="text-[10px] font-mono uppercase text-muted-foreground whitespace-nowrap">
            Beam:
          </span>
          <div className="flex-1 h-2 rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-800 relative">
            <div
              className={cn(
                "h-full w-full transition-all duration-200",
                isAligned
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                  : isFlutter
                  ? "bg-amber-500 animate-pulse"
                  : "bg-red-500/30"
              )}
            />
          </div>
          <ArrowRight
            className={cn(
              "w-3.5 h-3.5 transition-colors",
              isAligned ? "text-emerald-500" : isFlutter ? "text-amber-500" : "text-muted-foreground/40"
            )}
          />
        </div>

        {/* Status Badge */}
        <div className="w-full mt-2">
          {isAligned ? (
            <div className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-emerald-500/20 text-emerald-400 font-semibold text-xs border border-emerald-500/40">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Aligned (Intact)</span>
            </div>
          ) : isFlutter ? (
            <div className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-amber-500/20 text-amber-400 font-semibold text-xs border border-amber-500/40">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Marginal / Flutter</span>
            </div>
          ) : (
            <div className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-red-500/20 text-red-400 font-semibold text-xs border border-red-500/40">
              <XCircle className="w-3.5 h-3.5" />
              <span>Interrupted / Off</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const bothAligned = !sensor1Interrupted && !sensor2Interrupted && !sensor1Flutter && !sensor2Flutter;

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Overview Status Banner */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-mono",
          bothAligned
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            : "border-amber-500/40 bg-amber-500/10 text-amber-400"
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "w-2.5 h-2.5 rounded-full",
              bothAligned ? "bg-emerald-500 animate-pulse shadow-[0_0_6px_#10b981]" : "bg-amber-500"
            )}
          />
          <span className="font-semibold">
            {bothAligned ? "Both Light Barriers Aligned" : "Alignment Incomplete"}
          </span>
        </div>

        {/* Audio assist toggle */}
        <button
          type="button"
          onClick={toggleAudio}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-sans transition-colors border",
            audioFeedbackEnabled
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background/60 text-muted-foreground border-border hover:text-foreground"
          )}
          title="Audio assist for hands-free outdoor roadside alignment"
        >
          {audioFeedbackEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{audioFeedbackEnabled ? "Audio On" : "Audio Off"}</span>
        </button>
      </div>

      {/* Side-by-side Dual Light Barrier Assembly */}
      <div className={cn("relative flex items-stretch gap-3", compact ? "flex-col sm:flex-row" : "flex-row")}>
        {renderSensorUnit("Sensor 1", "GPIO 16", "Entry (S1)", sensor1Interrupted, sensor1Flutter)}

        {/* Assembly Spacing Callout */}
        <div className="hidden sm:flex flex-col items-center justify-center px-1 text-center select-none">
          <div className="h-full w-px bg-border/60 relative flex items-center justify-center">
            <span className="absolute bg-card border border-border px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground whitespace-nowrap shadow-xs">
              135 mm
            </span>
          </div>
        </div>

        {renderSensorUnit("Sensor 2", "GPIO 12", "Exit (S2)", sensor2Interrupted, sensor2Flutter)}
      </div>

      {/* Alignment Instructions Helper */}
      {!compact && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Sick Sensor Alignment Guide:</p>
          <ul className="list-disc list-inside space-y-0.5 font-mono text-[10px]">
            <li><span className="text-orange-400 font-bold">Solid Orange LED:</span> Reflector correctly targeted and locked.</li>
            <li><span className="text-amber-400 font-bold">Blinking Orange:</span> Marginal connection — adjust angle or clean reflector.</li>
            <li><span className="text-neutral-400 font-bold">LED Off:</span> Beam blocked or reflector out of field.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
