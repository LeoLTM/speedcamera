import { Outlet, createRootRoute } from "@tanstack/react-router";
import { NavigationMenu } from "@/components/NavigationMenu";
import { ThemeToggle } from "@/components/ThemeToggle";

export const RootRoute = createRootRoute({
  component: Root,
});

function Root() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* App-level navigation bar */}
      <div className="flex items-center justify-between border-b border-border">
        <NavigationMenu />
        <div className="px-2">
          <ThemeToggle />
        </div>
      </div>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
