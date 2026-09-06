import { useEffect } from "react";
import { useAlignmentStore } from "../store";
import { SickSensorVisualizer } from "./SickSensorVisualizer";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Play, Square, ExternalLink, Activity } from "lucide-react";

export function AlignmentSidePanel() {
  const { active, loading, startAlignment, stopAlignment, lastUpdate } = useAlignmentStore();

  // Auto-start alignment monitoring when sidepanel is mounted
  useEffect(() => {
    void startAlignment();
    return () => {
      void stopAlignment();
    };
  }, [startAlignment, stopAlignment]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Side Panel Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Sensor Alignment</h2>
          <p className="text-xs text-muted-foreground">Dual Sick optical light barriers</p>
        </div>

        <Link
          to="/alignment"
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          <span>Full View</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Control Button */}
      <div className="flex items-center gap-2">
        {!active ? (
          <Button
            size="sm"
            className="w-full"
            onClick={() => void startAlignment()}
            disabled={loading}
          >
            <Play className="w-3.5 h-3.5 mr-1.5" />
            Start Alignment Monitor
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
            onClick={() => void stopAlignment()}
            disabled={loading}
          >
            <Square className="w-3.5 h-3.5 mr-1.5" />
            Stop Monitor
          </Button>
        )}
      </div>

      {/* Sensor Visualizer */}
      <SickSensorVisualizer compact />

      {/* Heartbeat Footer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-2 border-t border-border/50">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
          <span>Stream: {active ? "Active (20Hz)" : "Dormant"}</span>
        </div>
        {lastUpdate && (
          <span>{new Date(lastUpdate).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
