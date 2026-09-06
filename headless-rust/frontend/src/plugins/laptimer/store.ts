import { create } from "zustand";
import type { Lap, LapSession, LapSessionWithLaps, SerialStatusPayload, AppSettings } from "@/shared/types";
import { getRpc } from "@/lib/rpc";

export type LapState = "idle" | "waiting" | "timing";

export interface LapSettings {
  lapMode: "single" | "multi";
  saveImages: boolean;
  dirFilter: "both" | "forward" | "reverse";
}

export interface LapStore {
  lapState: LapState;
  currentSession: LapSession | null;
  currentLaps: Lap[];
  lapNumber: number;
  lapTimingStartedAt: number | null;
  lapSettings: LapSettings;
  lapHistory: { sessions: LapSessionWithLaps[]; total: number };
  isLapSaving: boolean;

  startLapSession: () => Promise<void>;
  stopLapSession: () => Promise<void>;
  syncActiveSession: () => Promise<void>;
  handleSerialStatusForLap: (payload: SerialStatusPayload) => void;
  loadLapSettings: () => Promise<void>;
  updateLapSetting: (key: keyof AppSettings, value: string) => Promise<void>;
  fetchLapHistory: (page: number, limit: number) => Promise<void>;
  deleteHistorySession: (id: number) => Promise<void>;
  deleteHistoryLap: (id: number) => Promise<void>;
}

// ponytail: thin reactive store that reflects backend state instead of handling raw camera I/O
export const useLapStore = create<LapStore>()((set, get) => ({
  lapState: "idle",
  currentSession: null,
  currentLaps: [],
  lapNumber: 0,
  lapTimingStartedAt: null,
  lapHistory: { sessions: [], total: 0 },
  isLapSaving: false,
  lapSettings: {
    lapMode: "single",
    saveImages: true,
    dirFilter: "both",
  },

  startLapSession: async () => {
    const { lapSettings } = get();
    const session = await getRpc().request.startLapSession({
      lapMode: lapSettings.lapMode,
      dirFilter: lapSettings.dirFilter,
      saveImages: lapSettings.saveImages,
    });
    set({
      currentSession: session,
      currentLaps: [],
      lapNumber: 0,
      lapState: "waiting",
      lapTimingStartedAt: null,
    });
  },

  stopLapSession: async () => {
    await getRpc().request.stopLapSession({});
    set({
      lapState: "idle",
      currentSession: null,
      lapTimingStartedAt: null,
    });
  },

  syncActiveSession: async () => {
    try {
      const resp = await getRpc().request.getActiveLapSession({});
      if (resp.session) {
        set({
          currentSession: resp.session,
          currentLaps: resp.session.laps,
          lapState: resp.lapState as LapState,
          lapNumber: resp.lapNumber,
          lapTimingStartedAt: resp.lapTimingStartedAt,
        });
      } else {
        set({
          currentSession: null,
          lapState: resp.lapState as LapState,
          lapNumber: resp.lapNumber,
          lapTimingStartedAt: resp.lapTimingStartedAt,
        });
      }
    } catch (e) {
      console.warn("[lapStore] Failed to sync active session:", e);
    }
  },

  handleSerialStatusForLap: (payload) => {
    if (payload.status === "LAPWAITING") {
      set({ lapState: "waiting" });
      return;
    }

    if (payload.status === "LAPSTOPPED") {
      set({ lapState: "idle", lapTimingStartedAt: null });
      return;
    }

    if (payload.status === "LAPSTART") {
      const { lapSettings } = get();
      set({
        lapState: "timing",
        lapNumber: payload.lapNumber,
        lapTimingStartedAt: payload.timestamp || Date.now(),
      });
      return;
    }

    if (payload.status === "LAPEND") {
      const { lapSettings } = get();
      if (lapSettings.lapMode === "multi") {
        set({
          lapNumber: payload.lapNumber + 1,
          lapTimingStartedAt: payload.timestamp || Date.now(),
        });
      } else {
        set({
          lapState: "waiting",
          lapTimingStartedAt: null,
        });
      }

      // Backend in Rust has captured photo and inserted lap in DB; re-sync to get new lap + image paths
      void get().syncActiveSession();
    }
  },

  loadLapSettings: async () => {
    const settings = await getRpc().request.getSettings({});
    set({
      lapSettings: {
        lapMode: settings.lapMode === "multi" ? "multi" : "single",
        saveImages: settings.lapSaveImages !== "false",
        dirFilter: (settings.lapDirFilter === "forward" || settings.lapDirFilter === "reverse")
          ? settings.lapDirFilter
          : "both",
      },
    });
  },

  updateLapSetting: async (key, value) => {
    await getRpc().request.saveSetting({ key, value });
    set((state) => {
      const s = { ...state.lapSettings };
      if (key === "lapMode") s.lapMode = value === "multi" ? "multi" : "single";
      else if (key === "lapSaveImages") s.saveImages = value !== "false";
      else if (key === "lapDirFilter") s.dirFilter = (value === "forward" || value === "reverse") ? value : "both";
      return { lapSettings: s };
    });
  },

  fetchLapHistory: async (page, limit) => {
    const result = await getRpc().request.getLapSessions({ page, limit });
    set({ lapHistory: result });
  },

  deleteHistorySession: async (id) => {
    await getRpc().request.deleteLapSession({ id });
    const result = await getRpc().request.getLapSessions({ page: 1, limit: 20 });
    set({ lapHistory: result });
  },

  deleteHistoryLap: async (id) => {
    await getRpc().request.deleteLap({ id });
    set((state) => ({
      currentLaps: state.currentLaps.filter((l) => l.id !== id),
      lapHistory: {
        ...state.lapHistory,
        sessions: state.lapHistory.sessions.map((s) => ({
          ...s,
          laps: s.laps.filter((l) => l.id !== id),
        })),
      },
    }));
  },
}));
