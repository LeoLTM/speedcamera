import { createRoute } from "@tanstack/react-router";
import { Tabs as TabsPrimitive } from "radix-ui";
import { RootRoute } from "./__root";
import { cn } from "@/lib/utils";
import { DeviceTab } from "./settings/DeviceTab";
import { NetworkTab } from "./settings/NetworkTab";
import { CameraTab } from "./settings/CameraTab";
import { SpeedCameraTab } from "./settings/SpeedCameraTab";
import { pluginRegistry } from "@/plugins";

export const SettingsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: SettingsPage,
});

const CORE_TABS = [
  { id: "device", label: "Device", component: DeviceTab },
  { id: "network", label: "Network", component: NetworkTab },
  { id: "camera", label: "Camera", component: CameraTab },
  { id: "speed-camera", label: "Speed Camera", component: SpeedCameraTab },
];

function SettingsPage() {
  const allTabs = [...CORE_TABS, ...pluginRegistry.getSettingsTabs()];

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <TabsPrimitive.Root defaultValue="device" className="flex flex-col h-full">
        <TabsPrimitive.List className="flex shrink-0 border-b border-border px-2 sm:px-4 gap-0.5 overflow-x-auto no-scrollbar scroll-smooth">
          {allTabs.map((tab) => (
            <TabsPrimitive.Trigger
              key={tab.id}
              value={tab.id}
              className={cn(
                "shrink-0 whitespace-nowrap px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium text-muted-foreground",
                "border-b-2 border-transparent -mb-px transition-colors",
                "hover:text-foreground",
                "data-[state=active]:text-foreground data-[state=active]:border-primary",
              )}
            >
              {tab.label}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        {allTabs.map((tab) => {
          const Component = tab.component;
          return (
            <TabsPrimitive.Content key={tab.id} value={tab.id} className="flex-1 overflow-y-auto p-3.5 sm:p-6">
              <Component />
            </TabsPrimitive.Content>
          );
        })}
      </TabsPrimitive.Root>
    </div>
  );
}
