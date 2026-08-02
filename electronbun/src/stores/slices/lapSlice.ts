import type { StateCreator } from "zustand";
import type { Lap, LapSession, LapSessionWithLaps, SerialStatusPayload, AppSettings } from "@/shared/types";
import type { CameraSlice } from "./cameraSlice";
import type { TeableSlice } from "./teableSlice";
import { getRpc } from "@/lib/rpc";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LapState = "idle" | "waiting" | "timing";

export interface LapSettings {
  lapMode: "single" | "multi";
  saveImages: boolean;
  dirFilter: "both" | "forward" | "reverse";
}

export interface LapSlice {
  lapState: LapState;
  currentSession: LapSession | null;
  currentLaps: Lap[];
  /** Lap number that is currently being timed (1-based) */
  lapNumber: number;
  /** Host-side timestamp (Date.now()) captured when LAPSTART was received, for the live timer */
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

// ─── Module-level state (survives re-renders) ─────────────────────────────────

/** Base64 of the start image captured when timing began, awaiting lap completion */
let pendingStartImageBase64: string | null = null;
/** Guard to prevent re-entrant lap saves */
let lapSaving = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Removed grabFrame (using bun side captureFrame)
// ─── Slice ────────────────────────────────────────────────────────────────────

export const createLapSlice: StateCreator<
  LapSlice & CameraSlice & TeableSlice,
  [],
  [],
  LapSlice
> = (set, get) => ({
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

  // ── Session control ────────────────────────────────────────────────────────

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
    // Tell the ESP to start a lap session — it will drive all subsequent lap events
    await getRpc().request
      .sendCommand({ json: JSON.stringify({ command: "startLapSession", mode: lapSettings.lapMode, autoFlash: true, dirFilter: lapSettings.dirFilter }) })
      .catch((err: unknown) => console.error("[lapSlice] startLapSession command failed:", err));
  },

  stopLapSession: async () => {
    const { currentSession } = get();
    if (currentSession) {
      await getRpc().request.closeLapSession({ id: currentSession.id });
    }
    // Tell the ESP to stop emitting lap events
    await getRpc().request
      .sendCommand({ json: JSON.stringify({ command: "stopLapSession" }) })
      .catch((err: unknown) => console.error("[lapSlice] stopLapSession command failed:", err));
    pendingStartImageBase64 = null;
    lapSaving = false;
    set({
      lapState: "idle",
      currentSession: null,
      // Keep currentLaps so the UI can show the final session summary
    });
  },

  // ── State machine ──────────────────────────────────────────────────────────

  handleSerialStatusForLap: (payload) => {
    // ── LAPSTART: first car pass — firmware opened a new lap ──────────────────
    if (payload.status === "LAPSTART") {
      const { lapState, lapSettings } = get();

      // Accept "waiting" (first lap) or "timing" (MULTI lap N+1 boundary)
      const isMultiContinuation = lapState === "timing" && lapSettings.lapMode === "multi";
      if (lapState !== "waiting" && !isMultiContinuation) return;

      set({ lapState: "timing", lapNumber: payload.lapNumber, lapTimingStartedAt: Date.now() });

      (async () => {
        // In MULTI continuation, pendingStartImageBase64 is already set by LAPEND
        // to the end image of the previous lap — reuse it, no new capture needed here.
        if (isMultiContinuation) return;

        if (lapSettings.saveImages) {
            const b64 = await getRpc().request.captureFrame({});
            pendingStartImageBase64 = b64;
        } else {
            pendingStartImageBase64 = null;
        }
      })().catch((err: unknown) =>
        console.error("[lapSlice] Start image capture failed:", err)
      );
      return;
    }

    // ── LAPEND: second car pass — firmware computed the lap duration ───────────
    if (payload.status === "LAPEND") {
      const { lapState, currentSession, lapSettings, lapNumber } = get();
      if (lapState !== "timing" || !currentSession) return;
      if (lapSaving) return; // Guard against re-entrant saves
      lapSaving = true;

      const currentLapNumber  = lapNumber;
      const savedStartImage   = pendingStartImageBase64;
      pendingStartImageBase64 = null;

      const capturedSessionId = currentSession.id;
      const capturedSession   = currentSession;

      // durationMs is authoritative from the ESP (µs-precise float); round to ms for storage
      const durationMs   = Math.round(payload.durationMs);
      const { speedAtStart, speedAtEnd } = payload;
      // Derive wall-clock timestamps for DB storage / display
      const endTimestamp   = payload.timestamp;
      const startTimestamp = endTimestamp - durationMs;

      // Advance UI state immediately
      if (lapSettings.lapMode === "multi") {
        set({ lapTimingStartedAt: null, isLapSaving: true });
        // Stay in "timing"; the incoming LAPSTART for lap N+1 carries the authoritative lapNumber
      } else {
        // single → back to waiting for the next run
        set({ lapState: "waiting", lapNumber: 1, lapTimingStartedAt: null, isLapSaving: true });
      }

      (async () => {
        // Capture end image
        const endImageBase64 = lapSettings.saveImages ? await getRpc().request.captureFrame({}) : null;

        // Persist the lap
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

        // Fire-and-forget Teable sync (never blocks local save)
        if (get().teableSyncEnabled && capturedSession) {
          getRpc().request.syncLapToTeable({ lap, session: capturedSession }).catch((e: unknown) => {
            toast.error(`Teable sync failed: ${String(e)}`);
          });
        }

        // In multi mode, reuse end image as start image of the next lap
        if (lapSettings.lapMode === "multi") {
          pendingStartImageBase64 = endImageBase64;
        }
      })()
        .catch((err: unknown) => {
          console.error("[lapSlice] Lap save failed:", err);
          set({ isLapSaving: false });
        })
        .finally(() => {
          lapSaving = false;
        });
    }
  },

  // ── Settings ───────────────────────────────────────────────────────────────

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

  // ── History ────────────────────────────────────────────────────────────────

  fetchLapHistory: async (page, limit) => {
    const result = await getRpc().request.getLapSessions({ page, limit });
    set({ lapHistory: result });
  },

  deleteHistorySession: async (id) => {
    await getRpc().request.deleteLapSession({ id });
    // Re-fetch page 1 after deletion
    const result = await getRpc().request.getLapSessions({ page: 1, limit: 20 });
    set({ lapHistory: result });
  },

  deleteHistoryLap: async (id) => {
    await getRpc().request.deleteLap({ id });
    // Update in-place to avoid a full re-fetch
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
});
