// Database-related type definitions for speed violations
// Note: These types are also defined globally in src/types.d.ts for Window interface usage

export interface SpeedViolation {
  id: number;
  timestamp: string; // ISO 8601 format
  measuredSpeed: number;
  maxSpeed: number;
  imagePath: string;
  createdAt: string; // ISO 8601 format
}

export interface CreateSpeedViolation {
  measuredSpeed: number;
  maxSpeed: number;
  imagePath: string;
}
