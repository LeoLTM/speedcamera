import { useState } from "react";
import { useBackendEvent } from "@/hooks/useBackendEvent";
import { HugeiconsIcon } from "@hugeicons/react";
import { Wifi01Icon, WifiDisconnected01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

interface HeartbeatPayload {
  connected: boolean;
  latencyMs: number | null;
  degraded: boolean;
}

export function ConnectionIndicator() {
  const [isConnected, setIsConnected] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isDegraded, setIsDegraded] = useState(false);

  useBackendEvent("connectionChange", (connected) => {
    setIsConnected(connected as boolean);
    if (!connected) {
      setLatencyMs(null);
      setIsDegraded(true);
    }
  });

  useBackendEvent("heartbeat" as any, (data: any) => {
    const payload = data as HeartbeatPayload;
    setIsConnected(payload.connected);
    setLatencyMs(payload.latencyMs);
    setIsDegraded(payload.degraded);
  });

  const getStatusText = () => {
    if (!isConnected) return "Stalled / Reconnecting...";
    if (latencyMs !== null) {
      return `${latencyMs}ms`;
    }
    return "Connected";
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors font-mono",
        !isConnected
          ? "text-red-500 bg-red-500/10 animate-pulse border border-red-500/20"
          : isDegraded
          ? "text-amber-500 bg-amber-500/10 border border-amber-500/20"
          : "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20"
      )}
      title={
        !isConnected
          ? "Connection stalled or lost"
          : isDegraded
          ? `High latency (${latencyMs}ms)`
          : `Connected (${latencyMs ?? 0}ms)`
      }
    >
      <HugeiconsIcon 
        icon={isConnected ? Wifi01Icon : WifiDisconnected01Icon} 
        strokeWidth={2} 
        className="w-4 h-4" 
      />
      <span>{getStatusText()}</span>
    </div>
  );
}
