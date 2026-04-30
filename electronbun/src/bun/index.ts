import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { SpeedcameraRPC } from "../shared/types";
import {
  insertViolation,
  queryViolations,
  getViolationById,
  removeViolation,
  exportCsv,
  getSettings,
  saveSetting,
  createLapSession,
  closeLapSession,
  insertLap,
  getLapSessions,
  getLapSessionById,
  deleteLapSession,
  deleteLap,
} from "./database";
import { saveImage, readImageAsDataUrl, deleteImage } from "./filestore";
import {
  getAvailableCameras,
  getAvailableHwControls,
  setHwControl,
  resetHwControls,
} from "./camera";
import {
  initSerial,
  listPorts,
  openPort,
  closePort,
  sendCommand,
} from "./serial";
import {
  testTeableConnection,
  saveTeableConfig,
  removeTeableConfig,
  listTeableSpaces,
  listTeableBases,
  listTeableTables,
  verifyTeableTable,
  ensureTeableFields,
  createTeableTable,
  saveTeableTarget,
  syncLapToTeable,
} from "./teable";

// ─── Dev server / HMR ─────────────────────────────────────────────────────────

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<{ url: string; isDev: boolean }> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`[index] HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return { url: DEV_SERVER_URL, isDev: true };
    } catch {
      console.log("[index] Vite dev server not running — using bundled view.");
    }
  }
  return { url: "views://mainview/index.html", isDev: false };
}

// ─── RPC definition ───────────────────────────────────────────────────────────

const rpc = BrowserView.defineRPC<SpeedcameraRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {
      // ── Violations ──────────────────────────────────────────────────────────
      getViolations: (q) => queryViolations(q),

      getViolationById: ({ id }) => getViolationById(id),

      deleteViolation: async ({ id }) => {
        const v = getViolationById(id);
        if (v) {
          removeViolation(id);
          await deleteImage(v.imagePath);
        }
      },

      exportViolationsCsv: ({ dateFrom, dateTo, minSpeed }) =>
        exportCsv({ dateFrom, dateTo, minSpeed }),

      saveViolation: async ({ imageBase64, measuredSpeed, maxSpeed }) => {
        // Strip data-URL prefix if the view accidentally includes it
        const raw = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const imagePath = await saveImage(raw);
        return insertViolation({ imageBase64: raw, imagePath, measuredSpeed, maxSpeed });
      },

      // ── Lap Sessions ────────────────────────────────────────────────────────
      createLapSession: ({ lapMode }) => createLapSession(lapMode),

      closeLapSession: ({ id }) => {
        closeLapSession(id);
      },

      saveLap: async ({
        sessionId, lapNumber, startTimestamp, endTimestamp, durationMs,
        speedAtStart, speedAtEnd, startImageBase64, endImageBase64,
      }) => {
        const startRaw = startImageBase64
          ? startImageBase64.replace(/^data:image\/\w+;base64,/, "")
          : null;
        const endRaw = endImageBase64
          ? endImageBase64.replace(/^data:image\/\w+;base64,/, "")
          : null;
        const startImagePath = startRaw ? await saveImage(startRaw) : null;
        const endImagePath = endRaw ? await saveImage(endRaw) : null;
        return insertLap({
          sessionId, lapNumber, startTimestamp, endTimestamp, durationMs,
          speedAtStart, speedAtEnd,
          startImageBase64: null, // already saved to disk above; DB only uses the path
          endImageBase64: null,   // already saved to disk above; DB only uses the path
          startImagePath,
          endImagePath,
        });
      },

      getLapSessions: ({ page, limit }) => getLapSessions(page, limit),

      getLapSessionById: ({ id }) => getLapSessionById(id),

      deleteLapSession: ({ id }) => deleteLapSession(id),

      deleteLap: ({ id }) => deleteLap(id),

      // ── Images ──────────────────────────────────────────────────────────────
      getImageData: async ({ imagePath }) => {
        const data = await readImageAsDataUrl(imagePath);
        return data ?? "";
      },

      // ── Settings ────────────────────────────────────────────────────────────
      getSettings: () => getSettings(),

      saveSetting: ({ key, value }) => {
        saveSetting(key, value);
      },

      // ── Serial ──────────────────────────────────────────────────────────────
      listPorts: () => listPorts(),

      openPort: ({ path }) => openPort(path),

      closePort: () => closePort(),

      sendCommand: ({ json }) => {
        sendCommand(json);
      },

      // ── Camera HW ───────────────────────────────────────────────────────────
      getAvailableCameras: () => getAvailableCameras(),

      getAvailableHwControls: ({ cameraId }) => getAvailableHwControls(cameraId),

      setHwControl: ({ cameraId, name, value }) => setHwControl(cameraId, name, value),

      resetHwControls: ({ cameraId }) => resetHwControls(cameraId),

      // ── System ──────────────────────────────────────────────────────────────
      getPlatform: () => process.platform,
      // ── Teable ───────────────────────────────────────────────────────────────
      testTeableConnection: ({ url, token }) => testTeableConnection(url, token),

      saveTeableConfig: ({ url, token, userName, userEmail, userAvatar }) => {
        saveTeableConfig(url, token, userName, userEmail, userAvatar);
      },

      removeTeableConfig: () => {
        removeTeableConfig();
      },

      listTeableSpaces: () => listTeableSpaces(),

      listTeableBases: ({ spaceId }) => listTeableBases(spaceId),

      listTeableTables: ({ baseId }) => listTeableTables(baseId),

      verifyTeableTable: ({ tableId }) => verifyTeableTable(tableId),

      ensureTeableFields: ({ tableId }) => ensureTeableFields(tableId),

      createTeableTable: ({ baseId, tableName }) => createTeableTable(baseId, tableName),

      saveTeableTarget: ({ spaceId, baseId, tableId }) => {
        saveTeableTarget(spaceId, baseId, tableId);
      },

      syncLapToTeable: ({ lap, session }) => syncLapToTeable(lap, session),    },

    messages: {
      // No bun-side message handlers from the view in this schema
    },
  },
});

// ─── Window creation ──────────────────────────────────────────────────────────

const { url, isDev } = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "Speedcamera",
  url,
  frame: {
    width: 1280,
    height: 720,
    x: 200,
    y: 200,
  },
  rpc,
});

if (isDev) {
  mainWindow.webview.openDevTools();
}

// ─── Serial push bridge ───────────────────────────────────────────────────────

initSerial((payload) => {
  mainWindow.webview.rpc?.send.serialStatus(payload);
});

console.log("[index] Speedcamera started");

void mainWindow

