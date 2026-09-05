import type { ComponentType } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import type { SerialStatusPayload } from "@/shared/types";

export interface PluginMode {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number; size?: number }>;
}

export interface PluginNavItem {
  label: string;
  to: string;
}

export interface PluginSettingsTab {
  id: string;
  label: string;
  component: ComponentType;
}

// ponytail: minimal UI plugin contract without heavy microfrontend overhead
export interface UiPlugin {
  id: string;
  name: string;
  navItems?: PluginNavItem[];
  mode?: PluginMode;
  homeSidePanel?: ComponentType;
  settingsTabs?: PluginSettingsTab[];
  getRoutes?: (rootRoute: any) => AnyRoute[];
  onSerialStatus?: (payload: SerialStatusPayload) => boolean | void;
  init?: () => void;
}
