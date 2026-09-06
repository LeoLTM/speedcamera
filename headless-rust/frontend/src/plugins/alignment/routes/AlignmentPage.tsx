import { useEffect, useState } from "react";
import { useAlignmentStore } from "../store";
import { SickSensorVisualizer } from "../components/SickSensorVisualizer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Link } from "@tanstack/react-router";
import {
  Play,
  Square,
  Volume2,
  VolumeX,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Camera,
  Sparkles,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AlignmentPage() {
  const {
    active,
    loading,
    startAlignment,
    stopAlignment,
    sensor1Interrupted,
    sensor2Interrupted,
    audioFeedbackEnabled,
    toggleAudio,
    lastUpdate,
  } = useAlignmentStore();

  const [activeTab, setActiveTab] = useState<"align" | "test">("align");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [testEvents, setTestEvents] = useState<
    { id: number; text: string; time: string; ok: boolean }[]
  >([]);

  // Start monitoring automatically on mount, stop on unmount
  useEffect(() => {
    void startAlignment();
    return () => {
      void stopAlignment();
    };
  }, [startAlignment, stopAlignment]);

  // Track pass events during test mode
  useEffect(() => {
    if (!active) return;
    const nowStr = new Date().toLocaleTimeString();
    if (sensor1Interrupted && !sensor2Interrupted) {
      setTestEvents((prev) => [
        { id: Date.now(), text: "Sensor 1 (Entry) beam broken", time: nowStr, ok: true },
        ...prev.slice(0, 5),
      ]);
    } else if (!sensor1Interrupted && sensor2Interrupted) {
      setTestEvents((prev) => [
        { id: Date.now(), text: "Sensor 2 (Exit) beam broken", time: nowStr, ok: true },
        ...prev.slice(0, 5),
      ]);
    }
  }, [sensor1Interrupted, sensor2Interrupted, active]);

  const bothAligned = !sensor1Interrupted && !sensor2Interrupted;

  return (
    <div className="flex flex-col flex-1 p-3 sm:p-4 md:p-6 max-w-5xl mx-auto w-full space-y-3 sm:space-y-4">
      {/* ── Wizard Header ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">Sensor Alignment</h1>
            <Badge variant="outline" className="font-mono text-[10px] py-0">
              Hardware Setup
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dual Sick light barriers optical alignment &amp; physical verification.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAudio}
            className={cn("h-8 text-xs", audioFeedbackEnabled && "border-primary text-primary")}
          >
            {audioFeedbackEnabled ? <Volume2 className="size-3.5 mr-1" /> : <VolumeX className="size-3.5 mr-1" />}
            <span>{audioFeedbackEnabled ? "Audio On" : "Audio Assist"}</span>
          </Button>

          {!active ? (
            <Button size="sm" onClick={() => void startAlignment()} disabled={loading} className="h-8 text-xs">
              <Play className="size-3.5 mr-1" />
              Start Stream
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void stopAlignment()}
              disabled={loading}
              className="h-8 text-xs"
            >
              <Square className="size-3.5 mr-1" />
              Stop Stream
            </Button>
          )}
        </div>
      </div>

      {/* ── Stepper Navigation — Always Horizontal Grid ───────────── */}
      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/60">
        <button
          type="button"
          onClick={() => setActiveTab("align")}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all",
            activeTab === "align"
              ? "bg-background shadow-xs text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="size-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
            1
          </span>
          <span className="truncate">Alignment</span>
          {bothAligned && <CheckCircle2 className="size-3.5 text-emerald-500 ml-0.5 shrink-0" />}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("test")}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all",
            activeTab === "test"
              ? "bg-background shadow-xs text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="size-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
            2
          </span>
          <span className="truncate">Walk Test</span>
        </button>

        <Link
          to="/setup"
          className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all text-muted-foreground hover:text-foreground"
        >
          <span className="size-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
            3
          </span>
          <span className="truncate">Camera</span>
          <ChevronRight className="size-3.5 ml-0.5 text-muted-foreground/60 shrink-0" />
        </Link>
      </div>

      {/* ── Tab 1: Optical Alignment ──────────────────────────────── */}
      {activeTab === "align" && (
        <div className="space-y-3">
          {/* Unified Physical Assembly Card */}
          <Card className="border-border">
            <CardHeader className="py-2.5 px-3.5 border-b border-border/50">
              <CardTitle className="text-xs sm:text-sm font-semibold flex items-center justify-between">
                <span>Dual Barrier Assembly (Side-by-Side)</span>
                {lastUpdate && (
                  <span className="text-[10px] font-mono font-normal text-muted-foreground flex items-center gap-1">
                    <Activity className="size-3 text-emerald-500 animate-pulse" />
                    20 Hz Stream
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <SickSensorVisualizer />
            </CardContent>
          </Card>

          {/* Daylight Alignment Tips Accordion (Collapsible for zero clutter on mobile) */}
          <Collapsible open={tipsOpen} onOpenChange={setTipsOpen} className="rounded-xl border border-border bg-card">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 text-left text-xs font-semibold text-foreground hover:bg-muted/30 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-amber-500" />
                  <span>Daylight Alignment Instructions</span>
                </div>
                <ChevronDown
                  className={cn("size-4 text-muted-foreground transition-transform duration-200", tipsOpen && "rotate-180")}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-3 text-xs space-y-2 text-muted-foreground border-t border-border/40 pt-2.5">
              <div className="rounded-lg border p-2 bg-muted/20">
                <span className="font-semibold text-foreground">1. Coarse Aiming:</span> Point light barrier head towards roadside reflector center.
              </div>
              <div className="rounded-lg border p-2 bg-muted/20">
                <span className="font-semibold text-foreground">2. Micrometer Adjustment:</span> Turn bracket screws until both sensors show <span className="text-emerald-500 font-bold">ALIGNED</span>.
              </div>
              <div className="rounded-lg border p-2 bg-muted/20">
                <span className="font-semibold text-foreground">3. Flutter Correction:</span> If <span className="text-amber-500 font-bold">FLUTTER</span> flashes, reflector is on edge. Re-center until solid.
              </div>
              <div className="rounded-lg border p-2 bg-muted/20">
                <span className="font-semibold text-foreground">4. Audio Assist:</span> Listen for tone pitch shifts without staring at screen.
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* ── Tab 2: Walk-Through Trigger Test ───────────────────────── */}
      {activeTab === "test" && (
        <div className="space-y-3">
          <Card className="border-border">
            <CardHeader className="py-2.5 px-3.5 border-b border-border/50">
              <CardTitle className="text-xs sm:text-sm font-semibold">
                Beam Walk-Through Test
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Walk through beam: <strong>Sensor 1 (Entry)</strong> must trigger first, then <strong>Sensor 2 (Exit)</strong>.
              </p>

              <SickSensorVisualizer compact />

              {/* Event Log */}
              <div className="rounded-lg border p-2.5 bg-muted/20 space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground">
                  Recent Beam Events
                </div>
                {testEvents.length === 0 ? (
                  <p className="text-xs font-mono text-muted-foreground/60 py-2 text-center">
                    Break light barrier to record triggers.
                  </p>
                ) : (
                  <div className="space-y-1 font-mono text-xs">
                    {testEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="flex items-center justify-between py-1 px-2 rounded bg-background border text-foreground"
                      >
                        <span className="truncate">{evt.text}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{evt.time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Link to="/setup" className="block w-full pt-1">
                <Button className="w-full h-9 text-xs" size="sm">
                  <Camera className="size-3.5 mr-1.5" />
                  Proceed to Camera Framing
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
