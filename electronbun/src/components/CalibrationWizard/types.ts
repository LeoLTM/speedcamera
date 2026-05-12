export enum WizardStep {
  Intro = 1,
  Position = 2,
  ColorDetect = 3,
  Sweep = 4,
  Results = 5,
}

export interface FlashColor {
  h: number;       // hue 0–360
  s: number;       // saturation 0–100
  l: number;       // lightness 0–100
  tolerance: number; // hue tolerance in degrees
}

export interface CalibrationImage {
  flashDuration: number;   // ms
  pictureDelay: number;    // ms
  score: number;           // 0–1
  objectUrl: string;       // object URL for display; must be revoked on wizard close
}

export interface WizardState {
  currentStep: WizardStep;
  flashColor: FlashColor | null;
  calibImages: CalibrationImage[];
  selectedIndex: number | null;
  /** Original settings snapshot taken when wizard opens; restored on cancel/close */
  originalFlashDuration: number;
  originalPictureDelay: number;
}
