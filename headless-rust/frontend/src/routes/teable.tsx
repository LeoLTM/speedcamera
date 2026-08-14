import { createRoute } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import { ConnectionSection } from "./teable/ConnectionSection";
import { TableTargetSection } from "./teable/TableTargetSection";
import { SyncToggleSection } from "./teable/SyncToggleSection";

export const TeableRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/teable",
  component: TeablePage,
});

function TeablePage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-xl font-semibold">Teable Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sync lap times to a self-hosted Teable instance.
          </p>
        </div>
        <ConnectionSection />
        <TableTargetSection />
        <SyncToggleSection />
      </div>
    </div>
  );
}
