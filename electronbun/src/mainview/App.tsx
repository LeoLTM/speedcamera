import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RootRoute } from "@/routes/__root";
import { IndexRoute } from "@/routes/index";
import { ViolationsRoute } from "@/routes/violations";
import { SettingsRoute } from "@/routes/settings";
import { AboutRoute } from "@/routes/about";
import { LapsRoute } from "@/routes/laps";

// ─── Router ───────────────────────────────────────────────────────────────────

const routeTree = RootRoute.addChildren([
  IndexRoute,
  ViolationsRoute,
  SettingsRoute,
  AboutRoute,
  LapsRoute,
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
