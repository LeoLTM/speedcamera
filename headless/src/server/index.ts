import "./env";
import path from "path";
import { RpcServer, type RequestHandlers } from "./rpc";
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
  getUserDataDir,
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
  setCameraFeatureInt,
} from "./industrial-camera";
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
import { getSystemNetworkSummary, logNetworkStatus } from "./network";

// ─── Serial module (real or mock) ────────────────────────────────────────────
const isMock = !!process.env.MOCK_MODE;
const { initSerial, listPorts, openPort, closePort, sendCommand } = await (
  isMock ? import("./mock/serial") : import("./serial")
);

// ─── RPC Request Handlers ────────────────────────────────────────────────────
const handlers: RequestHandlers = {
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
    let raw = await captureFrame();
    if (!raw && isMock) {
      // In mock mode, generate a simple 1x1 base64 png if camera is not active
      raw = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    }
    if (!raw) throw new Error("Failed to capture frame from industrial camera");
    const imagePath = await saveImage(raw);
    const v = insertViolation({ imageBase64: raw, imagePath, measuredSpeed, maxSpeed, direction });
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
      startImageBase64: null,
      endImageBase64: null,
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
    return `/image?path=${encodeURIComponent(imagePath)}`;
  },

  getSkinnedImageData: async ({ violationId }) => {
    return `/skinned-image?violationId=${violationId}`;
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
        const outPath = path.join(targetDir, `violation-${v.id}-${ts}.png`);
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

  openPort: ({ path: portPath }) => openPort(portPath),

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
      rpcServer.broadcast("liveFrame", base64);
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

  // ── Window (Headless Stubs) ─────────────────────────────────────────────
  minimizeWindow: () => {},
  maximizeWindow: () => {},
  closeWindow: () => {},

  // ── System & Network ───────────────────────────────────────────────────
  getPlatform: () => process.platform,
  getNetworkInfo: () => getSystemNetworkSummary(),

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

  // ── Updater (Headless Service Stubs) ────────────────────────────────────
  getLocalVersion: async () => {
    return { version: "0.4.0-headless", channel: "headless", hash: "rpi-build" };
  },

  checkForUpdate: async () => {
    return {
      version: "0.4.0-headless",
      hash: "rpi-build",
      updateAvailable: false,
      updateReady: false,
      error: "Updater is managed by system package manager or git on headless Pi",
    };
  },

  downloadUpdate: async () => {
    return { ok: false, error: "Not supported in headless mode" };
  },

  applyUpdate: async () => {},

  // ── Firmware Flasher ────────────────────────────────────────────────────
  listFirmwareReleases: async () => {
    const { githubToken } = getSettings();
    return listFirmwareReleases(githubToken);
  },

  flashFirmware: async ({ releaseTag, port, firmwareAssetApiUrl }) => {
    const { githubToken } = getSettings();
    try { closePort(); } catch { /* ignore */ }
    await flashFirmware(releaseTag, port, firmwareAssetApiUrl, githubToken);
  },

  cancelFlash: () => cancelFlash(),

  testGithubToken: ({ token }) => testGithubToken(token),
};

const rpcServer = new RpcServer(handlers);

// ─── Push Bridges ─────────────────────────────────────────────────────────────
initSerial((payload) => {
  rpcServer.broadcast("serialStatus", payload);
});

initCameraPush((payload) => {
  rpcServer.broadcast("cameraStatus", payload);
});

initFlasher((payload) => {
  rpcServer.broadcast("flashProgress", payload);
});

// Auto-connect hardware on startup if configured
initCamera();

// ─── HTTP & WebSocket Server ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DIST_DIR = path.resolve(import.meta.dir, "../../dist");

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  websocket: {
    open(ws) {
      rpcServer.registerSocket(ws);
      console.log("[ws] Client connected");
      // Push current statuses immediately
      ws.send(JSON.stringify({ event: "cameraStatus", payload: getCameraStatus() }));
    },
    message(ws, message) {
      rpcServer.handleMessage(ws, message);
    },
    close(ws) {
      rpcServer.unregisterSocket(ws);
      console.log("[ws] Client disconnected");
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws/rpc" || url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Health check endpoint
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        uptime: process.uptime(),
        platform: process.platform,
        camera: getCameraStatus(),
        network: getSystemNetworkSummary(),
        mockMode: isMock,
      });
    }

    // Network status endpoint
    if (url.pathname === "/api/network") {
      return Response.json(getSystemNetworkSummary());
    }

    // Image serving endpoint
    if (url.pathname === "/image") {
      const imgPath = url.searchParams.get("path");
      if (!imgPath) return new Response("Missing path parameter", { status: 400 });
      const resolvedPath = path.resolve(imgPath);
      const allowedDir = path.resolve(getUserDataDir());
      if (!resolvedPath.startsWith(allowedDir)) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(resolvedPath);
      if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(file);
    }

    // Skinned image rendering endpoint
    if (url.pathname === "/skinned-image") {
      const idStr = url.searchParams.get("violationId");
      if (!idStr) return new Response("Missing violationId parameter", { status: 400 });
      const violationId = parseInt(idStr, 10);
      const v = getViolationById(violationId);
      if (!v) return new Response("Violation not found", { status: 404 });
      try {
        const settings = getSettings();
        const buf = await renderPoliscanSkin(v.imagePath, v, {
          measuringLocation: settings.skinMeasuringLocation,
        });
        return new Response(new Uint8Array(buf), {
          headers: { "Content-Type": "image/png" },
        });
      } catch (err) {
        console.error("[skinned-image] Rendering failed:", err);
        return new Response("Rendering failed", { status: 500 });
      }
    }

    // Static files from built frontend (dist/)
    let filePath = path.join(DIST_DIR, url.pathname);
    let file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback: return index.html for client-side routing
    const indexFile = Bun.file(path.join(DIST_DIR, "index.html"));
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(
      "Speedcamera Headless Server running. Build the frontend (`bun run build`) or run `bun run dev` for development.",
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  },
});

console.log(`[speedcamera-headless] Server listening on http://${HOST}:${PORT} (Mock mode: ${isMock})`);
console.log(`[speedcamera-headless] Data directory: ${getUserDataDir()}`);
logNetworkStatus();
