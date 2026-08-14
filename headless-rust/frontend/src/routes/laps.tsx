import { createRoute } from "@tanstack/react-router";
import { Tabs as TabsPrimitive } from "radix-ui";
import { RootRoute } from "./__root";
import { cn } from "@/lib/utils";
import { LiveSessionTab } from "./laps/LiveSessionTab";
import { HistoryTab } from "./laps/HistoryTab";

export const LapsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/laps",
  component: LapsPage,
});

function LapsPage() {
  return (
    <div className="h-full overflow-hidden flex flex-col">
      <TabsPrimitive.Root defaultValue="live" className="flex flex-col h-full">
        <TabsPrimitive.List className="flex shrink-0 border-b border-border px-4 gap-0.5">
          {(["live", "history"] as const).map((tab) => (
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
              {tab === "live" ? "Live Session" : "History"}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        <TabsPrimitive.Content value="live" className="flex-1 overflow-y-auto p-4">
          <LiveSessionTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="history" className="flex-1 overflow-y-auto p-4">
          <HistoryTab />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}
