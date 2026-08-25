import { createRoute } from "@tanstack/react-router";
import { Tabs as TabsPrimitive } from "radix-ui";
import { RootRoute } from "./__root";
import { cn } from "@/lib/utils";
import { DeviceTab } from "./settings/DeviceTab";
import { NetworkTab } from "./settings/NetworkTab";
import { CameraTab } from "./settings/CameraTab";
import { SpeedCameraTab } from "./settings/SpeedCameraTab";
import { LapTimerTab } from "./settings/LapTimerTab";

export const SettingsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="h-full overflow-hidden flex flex-col">
      <TabsPrimitive.Root defaultValue="device" className="flex flex-col h-full">
        <TabsPrimitive.List className="flex shrink-0 border-b border-border px-4 gap-0.5">
          {(["device", "network", "camera", "speed-camera", "lap-timer"] as const).map((tab) => (
            <TabsPrimitive.Trigger
              key={tab}
              value={tab}
              className={cn(
                "px-4 py-2.5 text-sm font-medium text-muted-foreground",
                "border-b-2 border-transparent -mb-px transition-colors",
                "hover:text-foreground",
                "data-[state=active]:text-foreground data-[state=active]:border-primary",
              )}
            >
              {tab === "device"
                ? "Device"
                : tab === "network"
                ? "Network"
                : tab === "camera"
                ? "Camera"
                : tab === "speed-camera"
                ? "Speed Camera"
                : "Lap Timer"}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        <TabsPrimitive.Content value="device" className="flex-1 overflow-y-auto p-6">
          <DeviceTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="network" className="flex-1 overflow-y-auto p-6">
          <NetworkTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="camera" className="flex-1 overflow-y-auto p-6">
          <CameraTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="speed-camera" className="flex-1 overflow-y-auto p-6">
          <SpeedCameraTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="lap-timer" className="flex-1 overflow-y-auto p-6">
          <LapTimerTab />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}
