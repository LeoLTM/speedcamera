import { useEffect } from "react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { initElectroview } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RootRoute } from "@/routes/__root";
import { IndexRoute } from "@/routes/index";
import { ViolationsRoute } from "@/routes/violations";
import { SettingsRoute } from "@/routes/settings";
import { AboutRoute } from "@/routes/about";

// ─── Router ───────────────────────────────────────────────────────────────────

const routeTree = RootRoute.addChildren([
  IndexRoute,
  ViolationsRoute,
  SettingsRoute,
  AboutRoute,
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
  const handleSerialStatus = useAppStore((s) => s.handleSerialStatus);

  useEffect(() => {
    // Initialize Electroview once; wire serial status pushes to the store.
    initElectroview((payload) => {
      handleSerialStatus(payload);
    });
  }, [handleSerialStatus]);

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
      <Toaster richColors position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;
