import { useEffect, useState, useRef } from "react";
import { createRoute } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import { useAppStore } from "@/stores/useAppStore";
import { useBackendEvent } from "@/hooks/useBackendEvent";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayIcon, SquareIcon, AlertCircleIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

export const SetupRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/setup",
  component: SetupPage,
});

function SetupPage() {
  const connected = useAppStore((s) => s.cameraConnected);
  const setupStreamActive = useAppStore((s) => s.setupStreamActive);
  const startSetupStream = useAppStore((s) => s.startSetupStream);
  const stopSetupStream = useAppStore((s) => s.stopSetupStream);
  const refreshCameraStatus = useAppStore((s) => s.refreshCameraStatus);

  const [frame, setFrame] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const setupStreamActiveRef = useRef(setupStreamActive);
  setupStreamActiveRef.current = setupStreamActive;

  // Real-time frame listener
  useBackendEvent("liveFrame", (newFrame) => {
    setFrame(newFrame as string);
  });

  // Refresh hardware status on mount
  useEffect(() => {
    void refreshCameraStatus();
  }, [refreshCameraStatus]);

  // Clean unmount: Stop stream only if it was active
  useEffect(() => {
    return () => {
      if (setupStreamActiveRef.current) {
        stopSetupStream().catch(console.error);
      }
    };
  }, [stopSetupStream]);

  const handleStart = async () => {
    if (!connected) {
      toast.error("Camera is not connected!");
      return;
    }
    setIsToggling(true);
    try {
      await startSetupStream();
      toast.success("Preview stream started");
    } catch {
      toast.error("Failed to start setup stream");
    } finally {
      setIsToggling(false);
    }
  };

  const handleStop = async () => {
    setIsToggling(true);
    try {
      await stopSetupStream();
      setFrame(null);
      toast.info("Preview stream stopped");
    } catch {
      toast.error("Failed to stop setup stream");
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold">Camera Setup</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <AlertCircleIcon className="h-4 w-4" />
            Flash strobe is temporarily disabled during setup. Auto-gain is active.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={setupStreamActive ? "default" : "secondary"}>
            {setupStreamActive ? "Streaming" : "Stopped"}
          </Badge>
          {!setupStreamActive ? (
            <Button onClick={handleStart} disabled={!connected || isToggling}>
              {isToggling ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayIcon className="mr-2 h-4 w-4" />
              )}
              Start Stream
            </Button>
          ) : (
            <Button variant="destructive" onClick={handleStop} disabled={isToggling}>
              {isToggling ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SquareIcon className="mr-2 h-4 w-4" />
              )}
              Stop Stream
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 bg-black/90 p-4 flex items-center justify-center relative overflow-hidden">
        {setupStreamActive ? (
          frame ? (
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt="Camera Livestream"
              className="object-contain w-full h-full select-none"
            />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-2">
              <span className="animate-pulse">Waiting for frame from camera...</span>
            </div>
          )
        ) : (
          <div className="text-muted-foreground text-center">
            <p>{connected ? "Click Start Stream to begin setup preview" : "Camera disconnected"}</p>
            {connected && (
              <p className="text-xs text-muted-foreground/60 mt-1">
                Preview renders at 10 FPS with continuous auto-exposure
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
