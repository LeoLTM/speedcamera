import "./env";
import path from "path";
import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
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
import { saveImage, deleteImage } from "./filestore";
import { renderPoliscanSkin } from "./skin-renderer";
import {
  initCamera,
  disconnectCamera,
  getCameraStatus,
  captureFrame,
  setExposure,
  setGain,
  initCameraPush,
  applyMfsConfig,
  startSetupStream,
  stopSetupStream,
  setPixelFormat,
  getPixelFormat,
  setStrobeDuration,
  setCameraFeatureStr,
  setCameraFeatureInt
} from "./industrial-camera";
// ─── Serial module (real or mock) ────────────────────────────────────────────
// process.env.MOCK_MODE is replaced at build time by Bun's `define` with an
// empty string for stable/canary builds, causing this branch to be dead-code
// eliminated. In dev mock mode the env var is truthy at runtime.
const { initSerial, listPorts, openPort, closePort, sendCommand } = await (
  process.env.MOCK_MODE
    ? import("./mock/serial")
    : import("./serial")
);
import { initFlasher, listFirmwareReleases, flashFirmware, cancelFlash, testGithubToken } from "./flasher";
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

// ─── Local Image Server ────────────────────────────────────────────────────────
let imageServer: ReturnType<typeof Bun.serve> | null = null;

function getImageServerPort(): number {
  if (!imageServer) {
    imageServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/image") {
          const imgPath = url.searchParams.get("path");
          if (!imgPath) return new Response("Missing path", { status: 400 });
          const resolvedPath = path.resolve(imgPath);
          const allowedDir = path.resolve(Utils.paths.userData);
          if (!resolvedPath.startsWith(allowedDir)) {
            return new Response("Forbidden", { status: 403 });
          }
          const file = Bun.file(resolvedPath);
          if (!(await file.exists())) {
            return new Response("Not Found", { status: 404 });
          }
          return new Response(file);
        }

        if (url.pathname === "/skinned-image") {
          const idStr = url.searchParams.get("violationId");
          if (!idStr) return new Response("Missing violationId", { status: 400 });
          const violationId = parseInt(idStr, 10);
          const v = getViolationById(violationId);
          if (!v) return new Response("Violation not found", { status: 404 });
          try {
            const settings = getSettings();
            const buf = await renderPoliscanSkin(v.imagePath, v, {
              measuringLocation: settings.skinMeasuringLocation,
            });
            return new Response(buf, {
              headers: { "Content-Type": "image/png" },
            });
          } catch (err) {
            console.error("[image-server] Skinned image rendering failed:", err);
            return new Response("Rendering failed", { status: 500 });
          }
        }

        return new Response("Not Found", { status: 404 });
      },
    });
    console.log(`[index] Image server started on http://127.0.0.1:${imageServer.port}`);
  }
  return imageServer.port;
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

      saveViolation: async ({ measuredSpeed, maxSpeed, direction }) => {
        // Bun captures directly from camera
        const raw = await captureFrame();
        if (!raw) throw new Error("Failed to capture frame from industrial camera");
        const imagePath = await saveImage(raw);
        const v = await insertViolation({ imageBase64: raw, imagePath, measuredSpeed, maxSpeed, direction });
        return v;
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
        if (!imagePath) return "";
        const port = getImageServerPort();
        return `http://127.0.0.1:${port}/image?path=${encodeURIComponent(imagePath)}`;
      },

      getSkinnedImageData: async ({ violationId }) => {
        const port = getImageServerPort();
        return `http://127.0.0.1:${port}/skinned-image?violationId=${violationId}`;
      },

      exportSkinnedImages: async ({ violationIds, targetDir }) => {
        const settings = getSettings();
        let exported = 0;
        let failed = 0;
        for (const id of violationIds) {
          try {
            const v = getViolationById(id);
            if (!v) { failed++; continue; }
            const buf = await renderPoliscanSkin(v.imagePath, v, {
              measuringLocation: settings.skinMeasuringLocation,
            });
            const ts = new Date(v.timestamp).toISOString().replace(/[:.]/g, "-");
            const outPath = `${targetDir}/violation-${v.id}-${ts}.png`;
            await Bun.write(outPath, buf);
            exported++;
          } catch (err) {
            console.error(`[skin-export] Failed to export violation ${id}:`, err);
            failed++;
          }
        }
        return { exported, failed };
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
      connectCamera: () => {
        initCamera();
      },

      disconnectCamera: () => {
        disconnectCamera();
      },

      getCameraStatus: () => getCameraStatus(),

      captureFrame: async () => {
        const b64 = await captureFrame();
        return b64 ?? null;
      },

      setCameraExposure: ({ value }) => {
        setExposure(value);
      },

      setCameraGain: ({ value }) => {
        setGain(value);
      },

      applyMfsConfig: ({ mfsContent, saveAsDefault }) => {
        return applyMfsConfig(mfsContent, saveAsDefault);
      },

      startSetupStream: () => {
        startSetupStream((base64) => {
          mainWindow.webview.rpc?.send.liveFrame(base64);
        });
      },

      stopSetupStream: () => {
        stopSetupStream();
      },

      setCameraPixelFormat: ({ format }) => {
        setPixelFormat(format);
      },

      getCameraPixelFormat: () => getPixelFormat(),

      setCameraStrobeDuration: ({ value }) => {
        setStrobeDuration(value);
      },

      setCameraFeatureStr: ({ feature, value }) => {
        setCameraFeatureStr(feature, value);
      },

      setCameraFeatureInt: ({ feature, value }) => {
        setCameraFeatureInt(feature, value);
      },

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

      syncLapToTeable: ({ lap, session }) => syncLapToTeable(lap, session),

      // ── Updater ─────────────────────────────────────────────────────────────
      applyUpdate: async () => {
        await Updater.applyUpdate();
      },

      // ── Firmware flasher ────────────────────────────────────────────────────
      listFirmwareReleases: async () => {
        const { githubToken } = getSettings();
        return listFirmwareReleases(githubToken);
      },

      flashFirmware: async ({ releaseTag, port, firmwareAssetApiUrl }) => {
        const { githubToken } = getSettings();
        // Auto-disconnect the serial port so esptool gets exclusive access
        try { closePort(); } catch { /* already closed */ }
        await flashFirmware(releaseTag, port, firmwareAssetApiUrl, githubToken);
      },

      cancelFlash: () => cancelFlash(),

      testGithubToken: ({ token }) => testGithubToken(token),
    },

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

initCameraPush((payload) => {
  mainWindow.webview.rpc?.send.cameraStatus(payload);
});

// Auto-connect camera on startup
initCamera();

// ─── Flash progress push bridge ──────────────────────────────────────────────

initFlasher((payload) => {
  mainWindow.webview.rpc?.send.flashProgress(payload);
});

// ─── Mock controller window ─────────────────────────────────────────────────
// This entire block is dead-code-eliminated from stable/canary builds because
// process.env.MOCK_MODE is replaced with "" by Bun's `define`.
if (process.env.MOCK_MODE) {
  const mockSerial = await import("./mock/serial");
  const { startMockServer } = await import("./mock/server");
  const mockPort = await startMockServer(mockSerial);
  new BrowserWindow({
    title: "Mock Device Controller",
    url: `http://localhost:${mockPort}/`,
    frame: { width: 320, height: 520, x: 50, y: 200 },
  });
  console.log(`[index] Mock controller window opened at http://localhost:${mockPort}`);
}

// ─── Auto-updater ─────────────────────────────────────────────────────────────

async function checkAndNotifyUpdate(): Promise<void> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") return;

  try {
    const info = await Updater.checkForUpdate();
    if (!info.updateAvailable) return;

    console.log(`[updater] Update available: ${info.version} — downloading…`);
    await Updater.downloadUpdate();

    if (Updater.updateInfo()?.updateReady) {
      console.log(`[updater] Update ready: ${info.version}`);
      mainWindow.webview.rpc?.send.updateAvailable({ version: info.version });
    }
  } catch (err) {
    console.error("[updater] Update check failed:", err);
  }
}

void checkAndNotifyUpdate();

console.log("[index] Speedcamera started");

void mainWindow

