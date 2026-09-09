import { useEffect, useState, useRef } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import { useAppStore } from "@/stores/useAppStore";
import { useAlignmentStore } from "@/plugins/alignment/store";
import { SickSensorVisualizer } from "@/plugins/alignment/components/SickSensorVisualizer";
import { ModeChangeGuardDialog } from "@/components/ModeChangeGuardDialog";
import { useBackendEvent } from "@/hooks/useBackendEvent";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PlayIcon,
  SquareIcon,
  AlertCircleIcon,
  Loader2Icon,
  Volume2,
  VolumeX,
  CheckCircle2,
  Sparkles,
  Activity,
  ArrowRight,
  Sliders,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const SetupRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/setup",
  component: UnifiedSetupPage,
});

function UnifiedSetupPage() {
  const navigate = useNavigate();

  // Operating mode & store
  const operatingMode = useAppStore((s) => s.operatingMode);
  const isArmed = useAppStore((s) => s.isArmed);
  const requestModeChange = useAppStore((s) => s.requestModeChange);
  const cameraConnected = useAppStore((s) => s.cameraConnected);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const refreshCameraStatus = useAppStore((s) => s.refreshCameraStatus);
  const liveFrame = useAppStore((s) => s.liveFrame);

  // Alignment store
  const {
    active: alignmentActive,
    sensor1Interrupted,
    sensor2Interrupted,
    audioFeedbackEnabled,
    toggleAudio,
    lastUpdate,
  } = useAlignmentStore();

  // Local state
  const [activeStep, setActiveStep] = useState<"alignment" | "camera">(
    operatingMode === "alignment" ? "alignment" : "camera"
  );
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);
  const [pendingTargetMode, setPendingTargetMode] = useState<string | null>(null);
  const [testEvents, setTestEvents] = useState<
    { id: number; text: string; time: string; ok: boolean }[]
  >([]);

  // Reflect external mode changes (e.g. from another client) into wizard tab
  useEffect(() => {
    if (operatingMode === "alignment") {
      setActiveStep("alignment");
    } else if (operatingMode === "setup") {
      setActiveStep("camera");
    }
  }, [operatingMode]);

  // Ensure initial mode is set on entry
  useEffect(() => {
    void refreshCameraStatus();
    if (operatingMode !== "alignment" && operatingMode !== "setup") {
      // Default entering wizard to alignment step
      void requestModeChange("alignment");
    }
  }, []);

  // Cleanup on unmount: return to speedcamera mode
  const operatingModeRef = useRef(operatingMode);
  operatingModeRef.current = operatingMode;
  useEffect(() => {
    return () => {
      if (operatingModeRef.current === "alignment" || operatingModeRef.current === "setup") {
        void useAppStore.getState().requestModeChange("speedcamera");
      }
    };
  }, []);

  // Track beam breaks during alignment
  useEffect(() => {
    if (operatingMode !== "alignment") return;
    const nowStr = new Date().toLocaleTimeString();
    if (sensor1Interrupted && !sensor2Interrupted) {
      setTestEvents((prev) => [
        { id: Date.now(), text: "Sensor 1 (Entry) beam broken", time: nowStr, ok: true },
        ...prev.slice(0, 4),
      ]);
    } else if (!sensor1Interrupted && sensor2Interrupted) {
      setTestEvents((prev) => [
        { id: Date.now(), text: "Sensor 2 (Exit) beam broken", time: nowStr, ok: true },
        ...prev.slice(0, 4),
      ]);
    }
  }, [sensor1Interrupted, sensor2Interrupted, operatingMode]);

  const handleStepSwitch = async (targetStep: "alignment" | "camera") => {
    const targetMode = targetStep === "alignment" ? "alignment" : "setup";
    if (operatingMode === targetMode) return;

    setIsChangingMode(true);
    try {
      const res = await requestModeChange(targetMode);
      if (!res.success) {
        if (res.safeguard === "ARMED") {
          setPendingTargetMode(targetMode);
          setGuardDialogOpen(true);
        } else {
          toast.error(res.message || "Failed to switch setup mode");
        }
      } else {
        setActiveStep(targetStep);
      }
    } finally {
      setIsChangingMode(false);
    }
  };

  const handleConfirmDisarmAndSwitch = async () => {
    if (!pendingTargetMode) return;
    setGuardDialogOpen(false);
    setIsChangingMode(true);
    try {
      const res = await requestModeChange(pendingTargetMode, true);
      if (res.success) {
        setActiveStep(pendingTargetMode === "alignment" ? "alignment" : "camera");
      } else {
        toast.error(res.message || "Failed to switch mode");
      }
    } finally {
      setIsChangingMode(false);
      setPendingTargetMode(null);
    }
  };

  const handleFinishSetup = async () => {
    setIsChangingMode(true);
    try {
      await requestModeChange("speedcamera");
      toast.success("Setup complete. Switched to Speed Camera mode.");
      navigate({ to: "/" });
    } finally {
      setIsChangingMode(false);
    }
  };

  const bothAligned = !sensor1Interrupted && !sensor2Interrupted;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* ── Top Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3 border-b border-border/70 bg-muted/20 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Hardware Setup Wizard</h1>
            <Badge variant="outline" className="font-mono text-[10px] py-0 border-primary/40 text-primary">
              Multi-Client Synced
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step-by-step optical barrier alignment and industrial camera preview.
          </p>
        </div>

        {/* Wizard Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFinishSetup}
            disabled={isChangingMode}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            <Check className="size-3.5 text-emerald-500" />
            <span>Finish Setup</span>
          </Button>
        </div>
      </div>

      {/* ── Stepper Header ────────────────────────────────────────── */}
      <div className="px-4 py-2 border-b border-border/50 bg-card shrink-0">
        <div className="grid grid-cols-2 gap-2 max-w-xl mx-auto">
          <button
            type="button"
            onClick={() => handleStepSwitch("alignment")}
            disabled={isChangingMode}
            className={cn(
              "flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all border",
              activeStep === "alignment"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "border-border/60 hover:bg-accent/40 text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                activeStep === "alignment"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              1
            </span>
            <span className="truncate">1. Sensor Alignment</span>
            {bothAligned && <CheckCircle2 className="size-3.5 text-emerald-400 ml-0.5 shrink-0" />}
          </button>

          <button
            type="button"
            onClick={() => handleStepSwitch("camera")}
            disabled={isChangingMode}
            className={cn(
              "flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all border",
              activeStep === "camera"
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "border-border/60 hover:bg-accent/40 text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                activeStep === "camera"
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              2
            </span>
            <span className="truncate">2. Camera Preview</span>
            {cameraConnected && <CheckCircle2 className="size-3.5 text-emerald-400 ml-0.5 shrink-0" />}
          </button>
        </div>
      </div>

      {/* ── Wizard Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-4">
        {activeStep === "alignment" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            {/* Alignment Controls Bar */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-card/60">
              <div className="flex items-center gap-2">
                <Badge variant={alignmentActive ? "default" : "secondary"}>
                  {alignmentActive ? "Alignment Active" : "Dormant"}
                </Badge>
                {lastUpdate && (
                  <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                    <Activity className="size-3 text-emerald-500 animate-pulse" />
                    Live 20Hz
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAudio}
                  className={cn("h-8 text-xs", audioFeedbackEnabled && "border-primary text-primary")}
                >
                  {audioFeedbackEnabled ? <Volume2 className="size-3.5 mr-1" /> : <VolumeX className="size-3.5 mr-1" />}
                  <span>{audioFeedbackEnabled ? "Audio Tone On" : "Audio Assist"}</span>
                </Button>
              </div>
            </div>

            {/* Visualizer */}
            <Card className="border-border shadow-xs">
              <CardHeader className="py-3 px-4 border-b border-border/50">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>Optical Light Barrier Status</span>
                  <span className="text-xs font-normal text-muted-foreground font-mono">
                    {connectedPort ? `Port: ${connectedPort}` : "Serial disconnected"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <SickSensorVisualizer />
              </CardContent>
            </Card>

            {/* Walk Test Events */}
            <Card className="border-border">
              <CardHeader className="py-2.5 px-4 border-b border-border/50">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Beam Break Test Log
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {testEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    Wave hand or object through sensors to verify sequence.
                  </p>
                ) : (
                  <div className="space-y-1.5 font-mono text-xs">
                    {testEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border/40"
                      >
                        <span className="flex items-center gap-1.5 text-foreground">
                          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                          {ev.text}
                        </span>
                        <span className="text-muted-foreground text-[10px]">{ev.time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Next Step Button */}
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => handleStepSwitch("camera")}
                disabled={isChangingMode}
                className="gap-1.5"
              >
                <span>Proceed to Camera Setup</span>
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {activeStep === "camera" && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            {/* Camera Setup Preview Box */}
            <Card className="border-border overflow-hidden">
              <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Live Camera Stream</CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Flash strobe disabled during preview. Real-time auto-exposure active.
                  </p>
                </div>
                <Badge variant={operatingMode === "setup" ? "default" : "secondary"}>
                  {operatingMode === "setup" ? "Streaming (10 FPS)" : "Standby"}
                </Badge>
              </CardHeader>

              <div className="bg-black aspect-video flex items-center justify-center relative overflow-hidden">
                {operatingMode === "setup" ? (
                  liveFrame ? (
                    <img
                      src={`data:image/jpeg;base64,${liveFrame}`}
                      alt="Camera Preview"
                      className="object-contain w-full h-full select-none"
                    />
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2">
                      <Loader2Icon className="size-6 animate-spin text-primary" />
                      <span className="text-xs">Receiving frames from GigE camera...</span>
                    </div>
                  )
                ) : (
                  <div className="text-muted-foreground text-center p-4">
                    <p className="text-sm">{cameraConnected ? "Preview stream paused" : "Camera disconnected"}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Switching to this step activates the live setup stream.
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Finish Button */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => handleStepSwitch("alignment")}
                disabled={isChangingMode}
              >
                Back to Alignment
              </Button>
              <Button
                onClick={handleFinishSetup}
                disabled={isChangingMode}
                className="gap-1.5"
              >
                <Check className="size-4 text-emerald-400" />
                <span>Finish Setup &amp; Arm Camera</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Safeguard Modal Dialog */}
      <ModeChangeGuardDialog
        open={guardDialogOpen}
        onOpenChange={setGuardDialogOpen}
        targetMode={pendingTargetMode || "setup"}
        isArmed={isArmed}
        onConfirm={handleConfirmDisarmAndSwitch}
        onCancel={() => {
          setGuardDialogOpen(false);
          setPendingTargetMode(null);
        }}
      />
    </div>
  );
}
