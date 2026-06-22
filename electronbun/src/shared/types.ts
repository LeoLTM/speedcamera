import { RPCSchema } from "electrobun/bun";

// ─── Domain Types ───────────────────────────────────────────────────────────

export interface Violation {
  id: number;
  timestamp: string;      // ISO 8601
  measuredSpeed: number;
  maxSpeed: number;
  direction: "forward" | "reverse";
  imagePath: string;
  createdAt: string;      // ISO 8601
}

export interface SaveViolationInput {
  imageBase64: string;    // raw base64 (no data-URL prefix)
  measuredSpeed: number;
  maxSpeed: number;
  direction: "forward" | "reverse";
}

export interface AppSettings {
  maxSpeed: number;         // km/h, default 30
  selectedPort: string;     // serial port path, default ""
  // Industrial Camera Settings
  cameraExposure: number;
  cameraGain: number;
  strobeLineDuration: number;
  // Lap timer settings
  lapMode: string;          // "single" | "multi", default "single"
  lapSaveImages: string;    // "true" | "false", default "true"
  lapDirFilter: string;     // "both" | "forward" | "reverse", default "both"
  // Teable integration
  teableUrl: string;
  teableToken: string;
  teableUserName: string;
  teableUserEmail: string;
  teableUserAvatar: string;
  teableSpaceId: string;
  teableBaseId: string;
  teableTableId: string;
  teableSyncEnabled: string; // "true" | "false"
  // GitHub access
  githubToken: string;
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  productId?: string;
  vendorId?: string;
}

export interface CameraStatusPayload {
  connected: boolean;
  vendor: string | null;
  model: string | null;
  serial: string | null;
}

export interface ViolationQuery {
  page: number;
  limit: number;
  dateFrom?: string;
  dateTo?: string;
  minSpeed?: number;
}

export interface ViolationPage {
  violations: Violation[];
  total: number;
}

// ─── Lap Timer Types ─────────────────────────────────────────────────────────

export interface LapSession {
  id: number;
  startedAt: string;      // ISO 8601
  endedAt: string | null; // ISO 8601, null while session is active
  lapMode: string;        // "single" | "multi"
  createdAt: string;      // ISO 8601
}

export interface Lap {
  id: number;
  sessionId: number;
  lapNumber: number;
  startTimestamp: number;       // ms (Date.now())
  endTimestamp: number;         // ms (Date.now())
  durationMs: number;
  speedAtStart: number;
  speedAtEnd: number;
  startImagePath: string | null;
  endImagePath: string | null;
}

export interface LapSessionWithLaps extends LapSession {
  laps: Lap[];
}

export interface SaveLapInput {
  sessionId: number;
  lapNumber: number;
  startTimestamp: number;
  endTimestamp: number;
  durationMs: number;
  speedAtStart: number;
  speedAtEnd: number;
  startImageBase64: string | null; // raw base64, no data-URL prefix
  endImageBase64: string | null;   // raw base64, no data-URL prefix
}

// ─── Teable Types ────────────────────────────────────────────────────────────

export interface TeableUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface TeableSpace {
  id: string;
  name: string;
}

export interface TeableBase {
  id: string;
  name: string;
  spaceId: string;
}

export interface TeableTable {
  id: string;
  name: string;
}

export interface TeableSchemaCheck {
  missingFields: string[];
}

export interface SyncLapInput {
  lap: Lap;
  session: LapSession;
}

// ─── ESP Pong Config ──────────────────────────────────────────────────────────

export interface EspPongConfig {
  maxSpeed: number;
  flashDelay: number;
  flashDuration: number;
  sensorDistance: number;
  debugEnabled: boolean;
  lapMode: "single" | "multi";
  lapActive: boolean;
  lapAutoFlash: boolean;
  lapDirFilter: "both" | "forward" | "reverse";
}

// ─── Firmware Flasher Types ───────────────────────────────────────────────────

export interface GithubRelease {
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  /** API URL for the firmware.bin asset — use with auth header for private repos */
  firmwareAssetApiUrl: string;
}

export type FlashProgressPayload =
  | { type: "downloading" }
  | { type: "output"; line: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ─── Serial Status Message ───────────────────────────────────────────────────

export type SerialStatusPayload =
  | { status: "SPEEDING"; value: number; tolerance: number; direction: "forward" | "reverse"; timestamp: number }
  | { status: "OK";       value: number; tolerance: number; direction: "forward" | "reverse"; timestamp: number }
  | { status: "PONG"; config: EspPongConfig }
  | { status: "LAPSTART"; lapNumber: number; speedAtStart: number; timestamp: number }
  | { status: "LAPEND";   lapNumber: number; durationMs: number; speedAtStart: number; speedAtEnd: number; timestamp: number }
  | { status: "LAPWAITING" }
  | { status: "LAPSTOPPED" }
  | { status: "CONNECTED" }
  | { status: "DISCONNECTED" };

// ─── RPC Schema ─────────────────────────────────────────────────────────────

export type SpeedcameraRPC = {
  bun: RPCSchema<{
    requests: {
      // DB – violations
      getViolations: {
        params: ViolationQuery;
        response: ViolationPage;
      };
      getViolationById: {
        params: { id: number };
        response: Violation | null;
      };
      deleteViolation: {
        params: { id: number };
        response: void;
      };
      exportViolationsCsv: {
        params: { dateFrom?: string; dateTo?: string; minSpeed?: number };
        response: string; // CSV text
      };
      saveViolation: {
        params: SaveViolationInput;
        response: Violation;
      };

      // DB – lap sessions
      createLapSession: {
        params: { lapMode: string };
        response: LapSession;
      };
      closeLapSession: {
        params: { id: number };
        response: void;
      };
      saveLap: {
        params: SaveLapInput;
        response: Lap;
      };
      getLapSessions: {
        params: { page: number; limit: number };
        response: { sessions: LapSessionWithLaps[]; total: number };
      };
      getLapSessionById: {
        params: { id: number };
        response: LapSessionWithLaps | null;
      };
      deleteLapSession: {
        params: { id: number };
        response: void;
      };
      deleteLap: {
        params: { id: number };
        response: void;
      };

      // DB – images
      getImageData: {
        params: { imagePath: string };
        response: string; // data-URL base64
      };

      // DB – settings
      getSettings: {
        params: Record<string, never>;
        response: AppSettings;
      };
      saveSetting: {
        params: { key: keyof AppSettings; value: string };
        response: void;
      };

      // Serial
      listPorts: {
        params: Record<string, never>;
        response: PortInfo[];
      };
      openPort: {
        params: { path: string };
        response: void;
      };
      closePort: {
        params: Record<string, never>;
        response: void;
      };
      sendCommand: {
        params: { json: string };
        response: void;
      };

      // Camera HW (Industrial / bun-aravis)
      connectCamera: {
        params: Record<string, never>;
        response: void;
      };
      disconnectCamera: {
        params: Record<string, never>;
        response: void;
      };
      getCameraStatus: {
        params: Record<string, never>;
        response: CameraStatusPayload;
      };
      captureFrame: {
        params: Record<string, never>;
        response: string | null; // base64
      };
      setCameraExposure: {
        params: { value: number };
        response: void;
      };
      setCameraGain: {
        params: { value: number };
        response: void;
      };

      // Window
      minimizeWindow: {
        params: Record<string, never>;
        response: void;
      };
      maximizeWindow: {
        params: Record<string, never>;
        response: void;
      };
      closeWindow: {
        params: Record<string, never>;
        response: void;
      };

      // System
      getPlatform: {
        params: Record<string, never>;
        response: string;
      };

      // Teable integration
      testTeableConnection: {
        params: { url: string; token: string };
        response: TeableUser;
      };
      saveTeableConfig: {
        params: { url: string; token: string; userName: string; userEmail: string; userAvatar: string | null };
        response: void;
      };
      removeTeableConfig: {
        params: Record<string, never>;
        response: void;
      };
      listTeableSpaces: {
        params: Record<string, never>;
        response: TeableSpace[];
      };
      listTeableBases: {
        params: { spaceId: string };
        response: TeableBase[];
      };
      listTeableTables: {
        params: { baseId: string };
        response: TeableTable[];
      };
      verifyTeableTable: {
        params: { tableId: string };
        response: TeableSchemaCheck;
      };
      ensureTeableFields: {
        params: { tableId: string };
        response: string[];
      };
      createTeableTable: {
        params: { baseId: string; tableName: string };
        response: TeableTable;
      };
      saveTeableTarget: {
        params: { spaceId: string; baseId: string; tableId: string };
        response: void;
      };
      syncLapToTeable: {
        params: SyncLapInput;
        response: void;
      };

      // Updater
      applyUpdate: {
        params: Record<string, never>;
        response: void;
      };

      // Firmware flasher
      listFirmwareReleases: {
        params: Record<string, never>;
        response: GithubRelease[];
      };
      flashFirmware: {
        params: { releaseTag: string; port: string; firmwareAssetApiUrl: string };
        response: void;
      };
      cancelFlash: {
        params: Record<string, never>;
        response: void;
      };
      testGithubToken: {
        params: { token: string };
        response: { valid: boolean; login?: string; error?: string };
      };
    };

    messages: Record<string, never>;
  }>;

  webview: RPCSchema<{
    requests: Record<string, never>;

    messages: {
      // Bun pushes serial measurement updates to the view
      serialStatus: SerialStatusPayload;
      // Bun pushes camera connection status to the view
      cameraStatus: CameraStatusPayload;
      // Bun notifies the view that a new app version is ready to install
      updateAvailable: { version: string };
      // Bun streams esptool progress events to the view
      flashProgress: FlashProgressPayload;
    };
  }>;
};
