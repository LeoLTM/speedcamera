import type { ComponentType } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import type { SerialStatusPayload } from "@/shared/types";
import type { UiPlugin, PluginNavItem, PluginMode, PluginSettingsTab } from "./types";

class PluginRegistry {
  private plugins: Map<string, UiPlugin> = new Map();

  public register(plugin: UiPlugin) {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[plugin-registry] Plugin ${plugin.id} already registered`);
      return;
    }
    this.plugins.set(plugin.id, plugin);
    plugin.init?.();
  }

  public getNavItems(): PluginNavItem[] {
    const items: PluginNavItem[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.navItems) {
        items.push(...plugin.navItems);
      }
    }
    return items;
  }

  public getModes(): PluginMode[] {
    const modes: PluginMode[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.mode) {
        modes.push(plugin.mode);
      }
    }
    return modes;
  }

  public getRoutes(rootRoute: any): AnyRoute[] {
    const routes: AnyRoute[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.getRoutes) {
        routes.push(...plugin.getRoutes(rootRoute));
      }
    }
    return routes;
  }

  public getSidePanel(modeId: string): ComponentType | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.mode?.id === modeId && plugin.homeSidePanel) {
        return plugin.homeSidePanel;
      }
    }
    return undefined;
  }

  public getSettingsTabs(): PluginSettingsTab[] {
    const tabs: PluginSettingsTab[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.settingsTabs) {
        tabs.push(...plugin.settingsTabs);
      }
    }
    return tabs;
  }

  public isPluginMode(modeId: string): boolean {
    for (const plugin of this.plugins.values()) {
      if (plugin.mode?.id === modeId) {
        return true;
      }
    }
    return false;
  }

  public dispatchSerialStatus(payload: SerialStatusPayload): boolean {
    let handled = false;
    for (const plugin of this.plugins.values()) {
      if (plugin.onSerialStatus) {
        const res = plugin.onSerialStatus(payload);
        if (res === true) handled = true;
      }
    }
    return handled;
  }

  public dispatchModeChange(mode: string): void {
    for (const plugin of this.plugins.values()) {
      plugin.onModeChange?.(mode);
    }
  }
}

export const pluginRegistry = new PluginRegistry();
