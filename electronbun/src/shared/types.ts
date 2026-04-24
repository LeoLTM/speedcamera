import { RPCSchema } from "electrobun/bun";

// ─── Domain Types ───────────────────────────────────────────────────────────

export interface Violation {
  id: number;
  timestamp: string;      // ISO 8601
  measuredSpeed: number;
  maxSpeed: number;
  imagePath: string;
  createdAt: string;      // ISO 8601
}

export interface SaveViolationInput {
  imageBase64: string;    // raw base64 (no data-URL prefix)
  measuredSpeed: number;
  maxSpeed: number;
}

export interface AppSettings {
  flashDelay: number;       // ms, default 100
  flashDuration: number;    // ms, default 50
  pictureDelay: number;     // ms, default 100
  maxSpeed: number;         // km/h, default 30
  selectedPort: string;     // serial port path, default ""
  selectedCamera: string;   // webcam deviceId, default ""
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

export interface CameraInfo {
  id: number;   // v4l2 device number (e.g. 0 for /dev/video0)
  name: string;
}

export interface HwControl {
  name: string;
  type: "int" | "bool" | "menu";
  min?: number;
  max?: number;
  step?: number;
  default: number;
  value: number;
  flags?: string;
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

// ─── Serial Status Message ───────────────────────────────────────────────────

export type SerialStatusPayload =
  | { status: "SPEEDING"; value: number; tolerance: number }
  | { status: "OK"; value: number; tolerance: number }
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

      // Camera HW (Linux / v4l2)
      getAvailableCameras: {
        params: Record<string, never>;
        response: CameraInfo[];
      };
      getAvailableHwControls: {
        params: { cameraId: number };
        response: HwControl[];
      };
      setHwControl: {
        params: { cameraId: number; name: string; value: number };
        response: void;
      };
      resetHwControls: {
        params: { cameraId: number };
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
    };

    messages: {
      // No bun-to-view messages handled on the bun request side
    };
  }>;

  webview: RPCSchema<{
    requests: Record<string, never>;

    messages: {
      // Bun pushes serial measurement updates to the view
      serialStatus: SerialStatusPayload;
    };
  }>;
};
