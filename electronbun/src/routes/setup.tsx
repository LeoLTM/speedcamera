import { useEffect } from "react";
import { createRoute } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import { useAppStore } from "@/stores/useAppStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayIcon, SquareIcon, AlertCircleIcon } from "lucide-react";
import { toast } from "sonner";

export const SetupRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/setup",
  component: SetupPage,
});

function SetupPage() {
  const connected = useAppStore((s) => s.cameraConnected);
  const setupStreamActive = useAppStore((s) => s.setupStreamActive);
  const liveFrame = useAppStore((s) => s.liveFrame);
  const startSetupStream = useAppStore((s) => s.startSetupStream);
  const stopSetupStream = useAppStore((s) => s.stopSetupStream);

  useEffect(() => {
    // Stop stream on unmount
    return () => {
      stopSetupStream().catch(console.error);
    };
  }, [stopSetupStream]);

  const handleStart = async () => {
    if (!connected) {
      toast.error("Camera is not connected!");
      return;
    }
    try {
      await startSetupStream();
    } catch (e) {
      toast.error("Failed to start setup stream");
    }
  };

  const handleStop = async () => {
    try {
      await stopSetupStream();
    } catch (e) {
      toast.error("Failed to stop setup stream");
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
            <Button onClick={handleStart} disabled={!connected}>
              <PlayIcon className="mr-2 h-4 w-4" /> Start Stream
            </Button>
          ) : (
            <Button variant="destructive" onClick={handleStop}>
              <SquareIcon className="mr-2 h-4 w-4" /> Stop Stream
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 bg-black/90 p-4 flex items-center justify-center relative overflow-hidden">
        {setupStreamActive ? (
          liveFrame ? (
            <img
              src={`data:image/jpeg;base64,${liveFrame}`}
              alt="Camera Livestream"
              className="object-contain w-full h-full"
            />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-2">
              <span className="animate-pulse">Waiting for frame...</span>
            </div>
          )
        ) : (
          <div className="text-muted-foreground">
            {connected ? "Click Start Stream to begin setup" : "Camera disconnected"}
          </div>
        )}
      </div>
    </div>
  );
}
