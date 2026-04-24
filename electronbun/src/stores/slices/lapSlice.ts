import type { StateCreator } from "zustand";
import type { Lap, LapSession, LapSessionWithLaps, SerialStatusPayload, AppSettings } from "@/shared/types";
import type { CameraSlice } from "./cameraSlice";
import { getRpc } from "@/lib/rpc";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LapState = "idle" | "waiting" | "timing";

export interface LapSettings {
  lapMode: "single" | "multi";
  flashOnStart: boolean;
  flashOnLapEnd: boolean;
  saveImages: boolean;
}

export interface LapSlice {
  lapState: LapState;
  currentSession: LapSession | null;
  currentLaps: Lap[];
  /** Lap number that is currently being timed (1-based) */
  lapNumber: number;
  /** The serial event that started the current lap */
  startEvent: { timestamp: number; speed: number } | null;
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

/**
 * Grabs a single frame from the given MediaStream and returns it as raw
 * base64 (no data-URL prefix).  Returns null if the track is unavailable.
 */
async function grabFrame(stream: MediaStream): Promise<string | null> {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return null;

  const imageCapture = new ImageCapture(videoTrack);
  const bitmap = await imageCapture.grabFrame();
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL("image/png").replace(/^data:image\/\w+;base64,/, "");
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const createLapSlice: StateCreator<
  LapSlice & CameraSlice,
  [],
  [],
  LapSlice
> = (set, get) => ({
  lapState: "idle",
  currentSession: null,
  currentLaps: [],
  lapNumber: 0,
  startEvent: null,
  lapHistory: { sessions: [], total: 0 },
  isLapSaving: false,
  lapSettings: {
    lapMode: "single",
    flashOnStart: true,
    flashOnLapEnd: true,
    saveImages: true,
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
      startEvent: null,
      lapState: "waiting",
    });
  },

  stopLapSession: async () => {
    const { currentSession } = get();
    if (currentSession) {
      await getRpc().request.closeLapSession({ id: currentSession.id });
    }
    pendingStartImageBase64 = null;
    lapSaving = false;
    set({
      lapState: "idle",
      currentSession: null,
      startEvent: null,
      // Keep currentLaps so the UI can show the final session summary
    });
  },

  // ── State machine ──────────────────────────────────────────────────────────

  handleSerialStatusForLap: (payload) => {
    // Only SPEEDING / OK carry a timestamp and speed value
    if (payload.status !== "SPEEDING" && payload.status !== "OK") return;

    const { lapState, currentSession, lapSettings, startEvent, lapNumber, cameraStream, pictureDelay } = get();
    const speed = payload.value;
    const timestamp = payload.timestamp;

    if (lapState === "idle") return;

    // ── waiting → timing ────────────────────────────────────────────────────
    if (lapState === "waiting") {
      set({ lapState: "timing", startEvent: { timestamp, speed }, lapNumber: 1 });

      (async () => {
        // Flash first (regardless of saveImages)
        if (lapSettings.flashOnStart) {
          await getRpc().request
            .sendCommand({ json: JSON.stringify({ command: "flash" }) })
            .catch((err: unknown) => console.error("[lapSlice] Flash (start) failed:", err));
          await new Promise<void>((res) => setTimeout(res, pictureDelay));
        }
        // Capture start image
        pendingStartImageBase64 =
          lapSettings.saveImages && cameraStream ? await grabFrame(cameraStream) : null;
      })().catch((err: unknown) =>
        console.error("[lapSlice] Start image capture failed:", err)
      );
      return;
    }

    // ── timing → (waiting | timing) ─────────────────────────────────────────
    if (lapState === "timing" && startEvent && currentSession) {
      if (lapSaving) return; // Guard against re-entrant saves
      lapSaving = true;

      const durationMs = timestamp - startEvent.timestamp;
      const currentLapNumber = lapNumber;
      const savedStartImage = pendingStartImageBase64;
      pendingStartImageBase64 = null;

      const capturedSessionId = currentSession.id;
      const capturedStartEvent = startEvent;

      // Advance state immediately so the UI reflects the new state
      if (lapSettings.lapMode === "multi") {
        set({ startEvent: { timestamp, speed }, lapNumber: lapNumber + 1, isLapSaving: true });
      } else {
        // single → back to waiting
        set({ lapState: "waiting", startEvent: null, isLapSaving: true });
      }

      (async () => {
        // Flash on lap end
        if (lapSettings.flashOnLapEnd) {
          await getRpc().request
            .sendCommand({ json: JSON.stringify({ command: "flash" }) })
            .catch((err: unknown) => console.error("[lapSlice] Flash (end) failed:", err));
          await new Promise<void>((res) => setTimeout(res, pictureDelay));
        }

        // Capture end image
        const endImageBase64 =
          lapSettings.saveImages && cameraStream ? await grabFrame(cameraStream) : null;

        // Persist the lap
        const lap = await getRpc().request.saveLap({
          sessionId: capturedSessionId,
          lapNumber: currentLapNumber,
          startTimestamp: capturedStartEvent.timestamp,
          endTimestamp: timestamp,
          durationMs,
          speedAtStart: capturedStartEvent.speed,
          speedAtEnd: speed,
          startImageBase64: savedStartImage,
          endImageBase64,
        });

        set((state) => ({ currentLaps: [...state.currentLaps, lap], isLapSaving: false }));

        // In multi mode, the end image doubles as the start image of the next lap
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
        flashOnStart: settings.lapFlashOnStart === "true",
        flashOnLapEnd: settings.lapFlashOnLapEnd === "true",
        saveImages: settings.lapSaveImages === "true",
      },
    });
  },

  updateLapSetting: async (key, value) => {
    await getRpc().request.saveSetting({ key, value });
    set((state) => {
      const s = { ...state.lapSettings };
      if (key === "lapMode") s.lapMode = value === "multi" ? "multi" : "single";
      else if (key === "lapFlashOnStart") s.flashOnStart = value === "true";
      else if (key === "lapFlashOnLapEnd") s.flashOnLapEnd = value === "true";
      else if (key === "lapSaveImages") s.saveImages = value === "true";
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
