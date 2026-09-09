#pragma once
#include <stdint.h>

// ─── Bidirectional Measurement State Machine ──────────────────────────────────
// Either sensor can be the "first" trigger. The sensor that fires first
// determines direction; the second sensor completes the measurement.
enum class MeasurementState : uint8_t { IDLE, WAITING_FOR_SECOND };
enum class FirstSensor      : uint8_t { NONE, SENSOR_ONE, SENSOR_TWO };

// ─── Operating Mode State Machine ─────────────────────────────────────────────
enum class OperatingMode    : uint8_t { SPEEDCAMERA, LAPTIMER, ALIGNMENT };

// ─── Measurement Event ────────────────────────────────────────────────────────
// Emitted when a passing vehicle triggers both sensors within valid window.
struct MeasurementEvent {
  float speedKmH;
  float toleranceKmH;
  const char *direction;     // "forward" | "reverse"
  unsigned long boundaryUs;  // µs timestamp of first beam break
};

