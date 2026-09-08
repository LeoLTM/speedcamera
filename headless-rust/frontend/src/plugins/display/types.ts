// ponytail: lean frontend types matching backend rust json models

export interface SpeedUiConfig {
  unit: "kmh" | "mph";
  style: "large" | "detailed";
  holdSecs: number;
}

export interface LapTimerUiConfig {
  style: "split" | "compact";
  showSpeed: boolean;
}

export interface AlignmentUiConfig {
  style: "bars" | "text";
}

export interface DisplayConfig {
  enabled: boolean;
  i2cBus: string;
  i2cAddress: number;
  rotation: number;
  contrast: number;
  mode: "auto" | "speedcamera" | "laptimer" | "alignment" | "system" | "off" | string;
  screenTimeoutSecs: number;
  speedUi: SpeedUiConfig;
  laptimerUi: LapTimerUiConfig;
  alignmentUi: AlignmentUiConfig;
}

export interface DisplayStatus {
  connected: boolean;
  mockMode: boolean;
  activeScreen: string;
  bus: string;
  address: string;
  width: number;
  height: number;
  error?: string | null;
}

export interface DisplayPreviewResponse {
  width: number;
  height: number;
  bitmapBase64: string;
  activeScreen: string;
}
