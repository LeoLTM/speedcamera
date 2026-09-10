import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RootRoute } from "@/routes/__root";
import { IndexRoute } from "@/routes/index";
import { ViolationsRoute } from "@/routes/violations";
import { SettingsRoute } from "@/routes/settings";
import { TeableRoute } from "@/routes/teable";
import { SetupRoute } from "@/routes/setup";
import { pluginRegistry } from "@/plugins";

// ─── Router ─────────────────────────────────────────────────────────────────────

const routeTree = RootRoute.addChildren([
  IndexRoute,
  ViolationsRoute,
  SettingsRoute,
  TeableRoute,
  SetupRoute,
  ...pluginRegistry.getRoutes(RootRoute),
]);

const history = createMemoryHistory({ initialEntries: ["/"] });

const router = createRouter({ routeTree, history });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <Toaster richColors position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;
