import { create } from "zustand";
import type { Lap, LapSession, LapSessionWithLaps, SerialStatusPayload, AppSettings } from "@/shared/types";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import { toast } from "sonner";

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
  handleSerialStatusForLap: (payload: SerialStatusPayload) => void;
  loadLapSettings: () => Promise<void>;
  updateLapSetting: (key: keyof AppSettings, value: string) => Promise<void>;
  fetchLapHistory: (page: number, limit: number) => Promise<void>;
  deleteHistorySession: (id: number) => Promise<void>;
  deleteHistoryLap: (id: number) => Promise<void>;
}

let pendingStartImageBase64: string | null = null;
let lapSaving = false;

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
    const session = await getRpc().request.createLapSession({ lapMode: lapSettings.lapMode });
    pendingStartImageBase64 = null;
    lapSaving = false;
    set({
      currentSession: session,
      currentLaps: [],
      lapNumber: 0,
      lapState: "waiting",
    });
    useAppStore.getState().setAppMode("laptimer");

    await getRpc().request
      .sendCommand({ json: JSON.stringify({ command: "startLapSession", mode: lapSettings.lapMode, autoFlash: true, dirFilter: lapSettings.dirFilter }) })
      .catch((err: unknown) => console.error("[lapStore] startLapSession command failed:", err));
  },

  stopLapSession: async () => {
    const { currentSession } = get();
    if (currentSession) {
      await getRpc().request.closeLapSession({ id: currentSession.id });
    }
    await getRpc().request
      .sendCommand({ json: JSON.stringify({ command: "stopLapSession" }) })
      .catch((err: unknown) => console.error("[lapStore] stopLapSession command failed:", err));
    pendingStartImageBase64 = null;
    lapSaving = false;
    set({
      lapState: "idle",
      currentSession: null,
      lapTimingStartedAt: null,
    });
  },

  handleSerialStatusForLap: (payload) => {
    if (payload.status === "LAPWAITING") {
      const { lapState, currentSession } = get();
      if (currentSession && lapState === "idle") {
        set({ lapState: "waiting" });
      }
      return;
    }

    if (payload.status === "LAPSTOPPED") {
      pendingStartImageBase64 = null;
      lapSaving = false;
      set({ lapState: "idle", lapTimingStartedAt: null });
      return;
    }

    if (payload.status === "LAPSTART") {
      const { lapState, lapSettings, currentSession } = get();
      const isMultiContinuation = lapState === "timing" && lapSettings.lapMode === "multi";
      if (lapState !== "waiting" && (lapState !== "idle" || !currentSession) && !isMultiContinuation) return;

      set({ lapState: "timing", lapNumber: payload.lapNumber, lapTimingStartedAt: Date.now() });

      (async () => {
        if (isMultiContinuation) return;
        if (lapSettings.saveImages) {
          const b64 = await getRpc().request.captureFrame({});
          pendingStartImageBase64 = b64;
        } else {
          pendingStartImageBase64 = null;
        }
      })().catch((err: unknown) =>
        console.error("[lapStore] Start image capture failed:", err)
      );
      return;
    }

    if (payload.status === "LAPEND") {
      const { lapState, currentSession, lapSettings, lapNumber } = get();
      if (lapState !== "timing" || !currentSession) return;
      if (lapSaving) return;
      lapSaving = true;

      const currentLapNumber = lapNumber;
      const savedStartImage = pendingStartImageBase64;
      pendingStartImageBase64 = null;

      const capturedSessionId = currentSession.id;
      const capturedSession = currentSession;

      const durationMs = Math.round(payload.durationMs);
      const { speedAtStart, speedAtEnd } = payload;
      const endTimestamp = payload.timestamp;
      const startTimestamp = endTimestamp - durationMs;

      if (lapSettings.lapMode === "multi") {
        set({ lapTimingStartedAt: null, isLapSaving: true });
      } else {
        set({ lapState: "waiting", lapNumber: 1, lapTimingStartedAt: null, isLapSaving: true });
      }

      (async () => {
        const endImageBase64 = lapSettings.saveImages ? await getRpc().request.captureFrame({}) : null;

        const lap = await getRpc().request.saveLap({
          sessionId: capturedSessionId,
          lapNumber: currentLapNumber,
          startTimestamp,
          endTimestamp,
          durationMs,
          speedAtStart,
          speedAtEnd,
          startImageBase64: savedStartImage,
          endImageBase64,
        });

        set((state) => ({ currentLaps: [...state.currentLaps, lap], isLapSaving: false }));

        const teableEnabled = (useAppStore.getState() as any).teableSyncEnabled;
        if (teableEnabled && capturedSession) {
          getRpc().request.syncLapToTeable({ lap, session: capturedSession }).catch((e: unknown) => {
            toast.error(`Teable sync failed: ${String(e)}`);
          });
        }

        if (lapSettings.lapMode === "multi") {
          pendingStartImageBase64 = endImageBase64;
        }
      })()
        .catch((err: unknown) => {
          console.error("[lapStore] Lap save failed:", err);
          set({ isLapSaving: false });
        })
        .finally(() => {
          lapSaving = false;
        });
    }
  },

  loadLapSettings: async () => {
    const settings = await getRpc().request.getSettings({});
    set({
      lapSettings: {
        lapMode: settings.lapMode === "multi" ? "multi" : "single",
        saveImages: settings.lapSaveImages === "true",
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
      else if (key === "lapSaveImages") s.saveImages = value === "true";
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
