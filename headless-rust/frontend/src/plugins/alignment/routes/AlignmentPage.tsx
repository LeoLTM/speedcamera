import { useEffect, useState } from "react";
import { useAlignmentStore } from "../store";
import { SickSensorVisualizer } from "../components/SickSensorVisualizer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { Play, Square, Volume2, VolumeX, CheckCircle2, ChevronRight, Camera, Sparkles, Activity } from "lucide-react";
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

  const [activeTab, setActiveTab] = useState<"align" | "test" | "camera">("align");
  const [testEvents, setTestEvents] = useState<{ id: number; text: string; time: string; ok: boolean }[]>([]);

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
        ...prev.slice(0, 7),
      ]);
    } else if (!sensor1Interrupted && sensor2Interrupted) {
      setTestEvents((prev) => [
        { id: Date.now(), text: "Sensor 2 (Exit) beam broken", time: nowStr, ok: true },
        ...prev.slice(0, 7),
      ]);
    }
  }, [sensor1Interrupted, sensor2Interrupted, active]);

  const bothAligned = !sensor1Interrupted && !sensor2Interrupted;

  return (
    <div className="flex flex-col flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
      {/* Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Roadside Setup Wizard</h1>
            <Badge variant="outline" className="font-mono text-xs">
              Hardware Setup
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Daylight optical alignment and physical verification for dual Sick light barriers.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAudio}
            className={cn(audioFeedbackEnabled && "border-primary text-primary")}
          >
            {audioFeedbackEnabled ? <Volume2 className="w-4 h-4 mr-1.5" /> : <VolumeX className="w-4 h-4 mr-1.5" />}
            <span>{audioFeedbackEnabled ? "Audio On" : "Audio Assist"}</span>
          </Button>

          {!active ? (
            <Button size="sm" onClick={() => void startAlignment()} disabled={loading}>
              <Play className="w-4 h-4 mr-1.5" />
              Start Stream
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void stopAlignment()}
              disabled={loading}
            >
              <Square className="w-4 h-4 mr-1.5" />
              Stop Stream
            </Button>
          )}
        </div>
      </div>

      {/* Stepper Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border rounded-xl p-1.5 bg-muted/30">
        <button
          type="button"
          onClick={() => setActiveTab("align")}
          className={cn(
            "flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all",
            activeTab === "align"
              ? "bg-background shadow-xs text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
            1
          </span>
          <span>Optical Alignment</span>
          {bothAligned && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("test")}
          className={cn(
            "flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all",
            activeTab === "test"
              ? "bg-background shadow-xs text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
            2
          </span>
          <span>Test Beam Trigger</span>
        </button>

        <Link
          to="/setup"
          className={cn(
            "flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
            3
          </span>
          <span>Camera Framing</span>
          <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground/60" />
        </Link>
      </div>

      {/* Main Tab Content */}
      {activeTab === "align" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Physical Assembly View</span>
                  {lastUpdate && (
                    <span className="text-xs font-mono font-normal text-muted-foreground flex items-center gap-1">
                      <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
                      Live Stream
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SickSensorVisualizer />
              </CardContent>
            </Card>
          </div>

          {/* Daylight Alignment Tips Card */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Daylight Alignment Protocol
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-3 text-muted-foreground">
                <div className="rounded-md border p-2.5 bg-muted/30">
                  <p className="font-semibold text-foreground mb-1">1. Coarse Optical Aiming</p>
                  <p>Point the light barrier head towards the roadside reflector across the road. Aim for the reflector center.</p>
                </div>

                <div className="rounded-md border p-2.5 bg-muted/30">
                  <p className="font-semibold text-foreground mb-1">2. Fine Screw Adjustment</p>
                  <p>Turn the horizontal and vertical micrometer adjustment screws on the bracket until both sensors display <span className="text-emerald-500 font-semibold">ALIGNED</span>.</p>
                </div>

                <div className="rounded-md border p-2.5 bg-muted/30">
                  <p className="font-semibold text-foreground mb-1">3. Check for Flutter</p>
                  <p>If the sensor displays <span className="text-amber-500 font-semibold">MARGINAL / FLUTTER</span>, the reflector is only partially covered. Re-center until the status is solid.</p>
                </div>

                <div className="rounded-md border p-2.5 bg-muted/30">
                  <p className="font-semibold text-foreground mb-1">4. Hands-Free Audio Assist</p>
                  <p>Enable <strong>Audio Assist</strong> above to listen for the high-frequency lock chime without needing to stare at the screen.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Beam Pass Test Tab */}
      {activeTab === "test" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Beam Walk-Through Test</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Walk past the sensors or wave a hand through the light barriers to confirm trigger sequence.
                  Sensor 1 (Entry) must fire first, followed by Sensor 2 (Exit).
                </p>

                <SickSensorVisualizer compact />

                <div className="rounded-lg border p-4 bg-muted/20">
                  <h4 className="text-xs font-mono uppercase tracking-wider font-semibold mb-2">
                    Recent Beam Trigger Events
                  </h4>
                  {testEvents.length === 0 ? (
                    <p className="text-xs font-mono text-muted-foreground/60 py-4 text-center">
                      No beam breaks recorded yet. Break beam to test.
                    </p>
                  ) : (
                    <div className="space-y-1.5 font-mono text-xs">
                      {testEvents.map((evt) => (
                        <div
                          key={evt.id}
                          className="flex items-center justify-between py-1 px-2 rounded bg-background border text-foreground"
                        >
                          <span>{evt.text}</span>
                          <span className="text-[10px] text-muted-foreground">{evt.time}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Ready for Camera Setup?</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-3">
                <p>
                  Once both optical light barriers pass the walk-through test cleanly, proceed to Camera Framing to align the GigE lens field of view with the road measurement line.
                </p>
                <Link to="/setup" className="block w-full">
                  <Button className="w-full" size="sm">
                    <Camera className="w-4 h-4 mr-1.5" />
                    Open Camera Setup
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
