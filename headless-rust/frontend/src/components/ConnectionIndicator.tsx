import { useState, useEffect } from "react";
import { useBackendEvent } from "@/hooks/useBackendEvent";
import { HugeiconsIcon } from "@hugeicons/react";
import { Wifi01Icon, WifiDisconnected01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export function ConnectionIndicator() {
  const [isConnected, setIsConnected] = useState(true);

  useBackendEvent("connectionChange", (connected) => {
    setIsConnected(connected as boolean);
  });

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
        isConnected
          ? "text-emerald-500 bg-emerald-500/10"
          : "text-red-500 bg-red-500/10 animate-pulse"
      )}
      title={isConnected ? "WebSocket Connected" : "WebSocket Disconnected"}
    >
      <HugeiconsIcon 
        icon={isConnected ? Wifi01Icon : WifiDisconnected01Icon} 
        strokeWidth={2} 
        className="w-4 h-4" 
      />
      <span>{isConnected ? "Connected" : "Reconnecting..."}</span>
    </div>
  );
}
