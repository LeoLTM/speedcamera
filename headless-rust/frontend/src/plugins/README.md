# Frontend Plugin System Guide (`frontend/src/plugins`)

This guide explains how AI software development agents and human developers must structure and implement frontend plugins for the Speed Camera web application.

For backend Rust plugins, see the [Backend Plugin System Guide](../../src/plugins/README.md).

---

## 1. Architectural Principles

1. **Zero Core UI Pollution:** Core layouts, navigation, and stores (`App.tsx`, `NavigationMenu.tsx`, `routes/index.tsx`, `routes/settings.tsx`, `useAppStore.ts`) must NEVER directly import or reference internal plugin components, routes, or stores.
2. **Slot & Registry Pattern:** All plugin extensions are declared via the `UiPlugin` interface and registered into the centralized `pluginRegistry`. Core UI queries the registry at runtime to populate navigation links, modes, side panels, settings tabs, and routes.
3. **Isolated State Management:** Each plugin MUST own its state in an independent Zustand store (e.g. `useLapStore`), stored inside its own directory. Plugins must NEVER inject slices into the global `useAppStore`.
4. **Declarative Extension Points:** Plugins extend the UI through slots:
   - Top-level page routes (`getRoutes`)
   - Header navigation links (`navItems`)
   - Dashboard operational modes & icons (`mode`)
   - Dashboard side panel widgets (`homeSidePanel`)
   - Settings page tabs (`settingsTabs`)
   - Hardware serial event interceptors (`onSerialStatus`)
   - Startup initialization (`init`)
5. **Typesafe Backend Interoperability:** Plugins communicate with their corresponding backend plugin via JSON-RPC over Socket.io (`getSocket().emitWithAck("rpc", ...)`).

---

## 2. Directory Layout

A frontend plugin lives in `frontend/src/plugins/<plugin_id>/`:

```
frontend/src/plugins/<plugin_id>/
├── index.ts                     # UiPlugin implementation & default export
├── store.ts                     # Plugin-isolated Zustand store & RPC actions
├── components/                  # UI components and slot widgets
│   ├── <Plugin>SidePanel.tsx    # Displayed on dashboard when plugin mode active
│   ├── <Plugin>SettingsTab.tsx  # Displayed inside /settings tabs
│   └── <Widget>.tsx             # Sub-components used across the plugin
├── routes/                      # TanStack Router page components
│   └── <Plugin>Page.tsx         # Dedicated full-page route (e.g. /laps)
└── hooks/                       # Optional custom React hooks
```

---

## 3. The `UiPlugin` Contract

Defined in [`frontend/src/plugins/types.ts`](./types.ts):

```typescript
export interface PluginMode {
  id: string;                                                      // e.g. "laptimer"
  label: string;                                                   // e.g. "Laps"
  icon: ComponentType<{ className?: string; strokeWidth?: number; size?: number }>;
}

export interface PluginNavItem {
  label: string;                                                   // e.g. "Laps"
  to: string;                                                      // e.g. "/laps"
}

export interface PluginSettingsTab {
  id: string;                                                      // e.g. "lap-timer"
  label: string;                                                   // e.g. "Lap Timer"
  component: ComponentType;
}

export interface UiPlugin {
  id: string;                                                      // Unique plugin ID
  name: string;                                                    // Display name
  navItems?: PluginNavItem[];                                      // Top navbar links
  mode?: PluginMode;                                               // Operational mode
  homeSidePanel?: ComponentType;                                   // Dashboard side panel
  settingsTabs?: PluginSettingsTab[];                              // Settings tab pages
  getRoutes?: (rootRoute: AnyRoute) => AnyRoute[];                 // TanStack page routes
  onSerialStatus?: (payload: SerialStatusPayload) => boolean | void;// Hardware serial hook
  init?: () => void;                                               // Startup hook
}
```

---

## 4. Step-by-Step Implementation Guide

### Step 1: Create Isolated Zustand Store (`store.ts`)

Keep all plugin state, backend RPC communication, and event handling isolated from core stores:

```typescript
// frontend/src/plugins/example/store.ts
import { create } from "zustand";
import { getSocket } from "@/lib/socket";

interface ExampleState {
  items: string[];
  loading: boolean;
  loadItems: () => Promise<void>;
  addItem: (item: string) => Promise<void>;
}

export const useExampleStore = create<ExampleState>((set, get) => ({
  items: [],
  loading: false,

  loadItems: async () => {
    set({ loading: true });
    try {
      const socket = getSocket();
      const res = await socket.emitWithAck("rpc", {
        method: "getExampleItems",
        params: {},
      });
      if (res && !res.error) {
        set({ items: res.result || [] });
      }
    } finally {
      set({ loading: false });
    }
  },

  addItem: async (item: string) => {
    const socket = getSocket();
    await socket.emitWithAck("rpc", {
      method: "addExampleItem",
      params: { item },
    });
    await get().loadItems();
  },
}));
```

### Step 2: Implement UI Slot Components

#### Side Panel Component (`components/ExampleSidePanel.tsx`)
Rendered on the main camera dashboard (`/`) when this plugin's mode is selected:

```tsx
// frontend/src/plugins/example/components/ExampleSidePanel.tsx
import { useEffect } from "react";
import { useExampleStore } from "../store";

export function ExampleSidePanel() {
  const { items, loadItems } = useExampleStore();

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  return (
    <div className="flex flex-col gap-4 p-4 border-b border-border">
      <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
        Example Monitor
      </h3>
      <div className="text-sm font-mono">{items.length} items recorded</div>
    </div>
  );
}
```

#### Settings Tab Component (`components/ExampleSettingsTab.tsx`)
Rendered inside `/settings`:

```tsx
// frontend/src/plugins/example/components/ExampleSettingsTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function ExampleSettingsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Example Plugin Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Configure example plugin options here.</p>
      </CardContent>
    </Card>
  );
}
```

#### Route Page Component (`routes/ExamplePage.tsx`)
Rendered when navigating to the plugin's dedicated full-screen URL (e.g. `/example`):

```tsx
// frontend/src/plugins/example/routes/ExamplePage.tsx
export function ExamplePage() {
  return (
    <div className="flex flex-col flex-1 p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Example Plugin</h1>
      <p className="text-muted-foreground">Full page view for example plugin.</p>
    </div>
  );
}
```

### Step 3: Declare `UiPlugin` in `index.ts`

Assemble slots into the plugin manifest:

```typescript
// frontend/src/plugins/example/index.ts
import { createRoute } from "@tanstack/react-router";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import type { UiPlugin } from "../types";
import { useExampleStore } from "./store";
import { ExampleSidePanel } from "./components/ExampleSidePanel";
import { ExampleSettingsTab } from "./components/ExampleSettingsTab";
import { ExamplePage } from "./routes/ExamplePage";

export const examplePlugin: UiPlugin = {
  id: "example",
  name: "Example Plugin",

  navItems: [
    { label: "Example", to: "/example" },
  ],

  mode: {
    id: "example",
    label: "Example",
    icon: SparklesIcon,
  },

  homeSidePanel: ExampleSidePanel,

  settingsTabs: [
    {
      id: "example-tab",
      label: "Example",
      component: ExampleSettingsTab,
    },
  ],

  getRoutes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/example",
      component: ExamplePage,
    }),
  ],

  onSerialStatus: (payload) => {
    // Intercept hardware serial messages from ESP32 radar
    if (payload.status?.startsWith("EXAMPLE_")) {
      // Process payload...
      return true; // Mark event as handled
    }
    return false;
  },

  init: () => {
    // Startup initialization (e.g. load initial configuration)
    void useExampleStore.getState().loadItems();
  },
};
```

### Step 4: Register the Plugin in `frontend/src/plugins/index.ts`

Import and register your plugin:

```typescript
// frontend/src/plugins/index.ts
import { pluginRegistry } from "./registry";
import { lapTimerPlugin } from "./laptimer";
import { examplePlugin } from "./example";

pluginRegistry.register(lapTimerPlugin);
pluginRegistry.register(examplePlugin);

export { pluginRegistry };
export * from "./types";
```

---

## 5. Hardware & Serial Event Handling

If your plugin interacts with ESP32 radar or sensors:

1. In backend plugin: implement `on_serial_event(&self, msg: &SerialStatusPayload, ctx: &PluginContext)`.
2. In frontend plugin: implement `onSerialStatus(payload: SerialStatusPayload)`.
   - Core `measurementSlice` routes serial status messages through `pluginRegistry.dispatchSerialStatus(payload)`.
   - Return `true` if the event is handled by your plugin to prevent default measurement processing.

---

## 6. Verification Checklist for AI Agents

Before concluding any frontend plugin implementation:

- [ ] `bun run build` succeeds with 0 TypeScript and build errors.
- [ ] No direct imports of `src/plugins/<plugin_id>/*` exist in core directories (`src/components/`, `src/routes/`, `src/stores/`, `src/App.tsx`).
- [ ] Plugin mode appears in the dashboard mode selector and switches panels smoothly.
- [ ] Dedicated routes (e.g. `/example`) resolve properly without router warnings.
- [ ] Settings tab renders under `/settings` and persists options.
- [ ] State is completely self-contained within `src/plugins/<plugin_id>/store.ts`.
