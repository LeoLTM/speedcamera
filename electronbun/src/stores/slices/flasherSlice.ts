import type { StateCreator } from "zustand";
import type { FlashProgressPayload } from "@/shared/types";

export interface FlasherSlice {
  isFlashing: boolean;
  flashProgressLines: string[];
  flashError: string | null;
  flashDone: boolean;
  handleFlashProgress: (payload: FlashProgressPayload) => void;
  resetFlash: () => void;
}

export const createFlasherSlice: StateCreator<FlasherSlice, [], [], FlasherSlice> = (set) => ({
  isFlashing: false,
  flashProgressLines: [],
  flashError: null,
  flashDone: false,

  handleFlashProgress: (payload) => {
    switch (payload.type) {
      case "downloading":
        set({ isFlashing: true, flashProgressLines: ["Downloading firmware…"], flashError: null, flashDone: false });
        break;
      case "output":
        set((s) => ({ flashProgressLines: [...s.flashProgressLines, payload.line] }));
        break;
      case "done":
        set({ isFlashing: false, flashDone: true });
        break;
      case "error":
        set({ isFlashing: false, flashError: payload.message });
        break;
    }
  },

  resetFlash: () =>
    set({ isFlashing: false, flashProgressLines: [], flashError: null, flashDone: false }),
});
