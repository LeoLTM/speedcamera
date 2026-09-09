import { createRoute } from "@tanstack/react-router";
import { Crosshair } from "lucide-react";
import type { UiPlugin } from "../types";
import { useAlignmentStore } from "./store";
import { AlignmentSidePanel } from "./components/AlignmentSidePanel";
import { AlignmentPage } from "./routes/AlignmentPage";

export const alignmentPlugin: UiPlugin = {
  id: "alignment",
  name: "Sensor Alignment",

  mode: {

    id: "alignment",
    label: "Alignment",
    icon: Crosshair,
  },

  homeSidePanel: AlignmentSidePanel,

  getRoutes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/alignment",
      component: AlignmentPage,
    }),
  ],

  onSerialStatus: (payload) => {
    if (payload.status === "BARRIER_STATUS") {
      useAlignmentStore.getState().handleSerialStatus(payload);
      return true;
    }
    return false;
  },

  onModeChange: (mode: string) => {
    useAlignmentStore.setState({ active: mode === "alignment" });
  },
};

