#pragma once
#include <stdint.h>

// ─── Bidirectional Measurement State Machine ──────────────────────────────────
// Either sensor can be the "first" trigger. The sensor that fires first
// determines direction; the second sensor completes the measurement.
enum class MeasurementState : uint8_t { IDLE, WAITING_FOR_SECOND };
enum class FirstSensor      : uint8_t { NONE, SENSOR_ONE, SENSOR_TWO };

// ─── Lap Timer State Machine ──────────────────────────────────────────────────
// The host starts/stops a lap session via serial commands.  Once a session is
// active the firmware drives the state machine: the first car pass opens a
// lap (WAITING → TIMING) and the second car pass closes it (TIMING → WAITING
// for SINGLE mode, or TIMING → TIMING with an incremented counter for MULTI).
enum class LapMode            : uint8_t { SINGLE, MULTI };
enum class LapSessionState    : uint8_t { IDLE, WAITING, TIMING };
enum class LapDirectionFilter : uint8_t { BOTH, FORWARD_ONLY, REVERSE_ONLY };
