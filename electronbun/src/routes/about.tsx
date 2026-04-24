import { createRoute } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";

const APP_VERSION = "1.0.0";
const GITHUB_URL = "https://github.com/LeoLTM/speedcamera";

export const AboutRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/about",
  component: AboutPage,
});

function AboutPage() {
  const handleOpenGitHub = () => {
    // In Electrobun, window.open should open system browser
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
      <div className="space-y-2">
        <div className="flex items-center justify-center size-16 rounded-2xl bg-primary/10 mx-auto mb-2">
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Speedcamera</h1>
        <p className="text-sm text-muted-foreground">
          Companion app for the ESP32-based speed camera
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card px-6 py-4 space-y-1 text-sm">
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono font-medium">{APP_VERSION}</span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">Runtime</span>
          <span className="font-mono font-medium">Electrobun + Bun</span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">UI</span>
          <span className="font-mono font-medium">React + shadcn/ui</span>
        </div>
      </div>

      <Button variant="outline" onClick={handleOpenGitHub}>
        View on GitHub
      </Button>

      <p className="text-xs text-muted-foreground/50 max-w-xs">
        Built to detect and log speed violations using a webcam and Arduino/ESP32 + light barriers.
      </p>
    </div>
  );
}
