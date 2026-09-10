import { create } from "zustand";
import { getRpc } from "@/lib/rpc";
import type { DisplayConfig, DisplayStatus, DisplayPreviewResponse } from "./types";

interface DisplayStore {
  config: DisplayConfig | null;
  status: DisplayStatus | null;
  preview: DisplayPreviewResponse | null;
  loading: boolean;
  saving: boolean;
  autoRefresh: boolean;

  loadConfig: () => Promise<void>;
  updateConfig: (partial: Partial<DisplayConfig>) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  togglePower: () => Promise<void>;
  fetchPreview: () => Promise<void>;
  setAutoRefresh: (enabled: boolean) => void;
  syncDashboardMode: (dashboardMode: string) => Promise<void>;
}

// ponytail: isolated zustand store with direct proxy rpc dispatch
export const useDisplayStore = create<DisplayStore>()((set, get) => ({
  config: null,
  status: null,
  preview: null,
  loading: false,
  saving: false,
  autoRefresh: false,

  loadConfig: async () => {
    set({ loading: true });
    try {
      const res = await (getRpc().request as any).getDisplayConfig({});
      if (res && res.config) {
        set({
          config: res.config,
          status: res.status,
        });
      }
    } catch (err) {
      console.warn("[plugin:display] Failed to load config:", err);
    } finally {
      set({ loading: false });
    }
  },

  updateConfig: async (partial: Partial<DisplayConfig>) => {
    const current = get().config;
    if (!current) return;
    const updated = { ...current, ...partial };
    set({ saving: true });
    try {
      const res = await (getRpc().request as any).updateDisplayConfig(updated);
      if (res?.config) {
        set({ config: res.config });
      }
    } finally {
      set({ saving: false });
      void get().fetchPreview();
    }
  },

  setMode: async (mode: string) => {
    try {
      await (getRpc().request as any).setDisplayMode({ mode });
      const current = get().config;
      if (current) {
        set({ config: { ...current, mode } });
      }
      void get().fetchPreview();
    } catch (err) {
      console.warn("[plugin:display] Failed to set mode:", err);
    }
  },

  togglePower: async () => {
    const current = get().config;
    if (!current) return;
    const next = !current.enabled;
    try {
      await (getRpc().request as any).setDisplayPower({ enabled: next });
      set({ config: { ...current, enabled: next } });
      void get().fetchPreview();
    } catch (err) {
      console.warn("[plugin:display] Failed to toggle power:", err);
    }
  },

  fetchPreview: async () => {
    try {
      const res = await (getRpc().request as any).getDisplayPreview({});
      if (res && res.bitmapBase64) {
        set({ preview: res });
      }
    } catch (err) {
      console.warn("[plugin:display] Failed to fetch preview:", err);
    }
  },

  setAutoRefresh: (enabled: boolean) => {
    set({ autoRefresh: enabled });
  },

  syncDashboardMode: async (_dashboardMode: string) => {
    const { config } = get();
    // In auto mode, backend OLED render loop automatically matches operating mode.
    // Do NOT call setDisplayMode here to avoid overwriting auto mode with a locked screen.
    if (config?.mode === "auto") {
      void get().fetchPreview();
    }
  },
}));
