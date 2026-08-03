import type { StateCreator } from "zustand";

export type UpdatePhase = "idle" | "checking" | "downloading" | "ready" | "error";

export interface UpdaterSlice {
  updatePhase: UpdatePhase;
  updateMessage: string;
  updateProgress: number | null;
  updateVersion: string | null;
  updateError: string | null;
  handleUpdateProgress: (payload: {
    status: string;
    message: string;
    progress?: number;
  }) => void;
  resetUpdater: () => void;
  setUpdatePhase: (phase: UpdatePhase) => void;
  setUpdateVersion: (version: string | null) => void;
  setUpdateError: (error: string | null) => void;
}

export const createUpdaterSlice: StateCreator<UpdaterSlice, [], [], UpdaterSlice> = (set) => ({
  updatePhase: "idle",
  updateMessage: "",
  updateProgress: null,
  updateVersion: null,
  updateError: null,

  handleUpdateProgress: (payload) => {
    const { status, message, progress } = payload;
    // Map granular electrobun status to coarse UI phase
    let phase: UpdatePhase = "idle";
    if (status === "checking" || status === "check-complete" || status === "no-update" || status === "update-available") {
      phase = "checking";
    } else if (
      status === "downloading" ||
      status === "download-starting" ||
      status === "checking-local-tar" ||
      status === "local-tar-found" ||
      status === "local-tar-missing" ||
      status === "fetching-patch" ||
      status === "patch-found" ||
      status === "patch-not-found" ||
      status === "downloading-patch" ||
      status === "applying-patch" ||
      status === "patch-applied" ||
      status === "patch-failed" ||
      status === "extracting-version" ||
      status === "patch-chain-complete" ||
      status === "downloading-full-bundle" ||
      status === "download-progress" ||
      status === "decompressing" ||
      status === "download-complete"
    ) {
      phase = "downloading";
    } else if (status === "complete" || status === "applying" || status === "extracting" || status === "replacing-app" || status === "launching-new-version") {
      phase = "ready";
    } else if (status === "error") {
      phase = "error";
    }

    set((s) => ({
      updatePhase: phase === "idle" ? s.updatePhase : phase,
      updateMessage: message,
      updateProgress: progress ?? s.updateProgress,
      updateError: status === "error" ? message : s.updateError,
    }));
  },

  resetUpdater: () =>
    set({
      updatePhase: "idle",
      updateMessage: "",
      updateProgress: null,
      updateVersion: null,
      updateError: null,
    }),

  setUpdatePhase: (phase) => set({ updatePhase: phase }),
  setUpdateVersion: (version) => set({ updateVersion: version }),
  setUpdateError: (error) => set({ updateError: error }),
});