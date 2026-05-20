#pragma once
#include <Arduino.h>
#include "config.h"
#include "types.h"

// ─── Configurable Parameters (adjustable via serial commands) ─────────────────
extern float maxSpeedKmH;     // Speed limit (km/h)
extern int   flashTime;       // Flash duration (ms)
extern int   waitBeforeFlash; // Pre-flash delay (ms) for camera sync
extern bool  debugEnabled;    // Enable verbose debug JSON output

// ─── Serial Input State ───────────────────────────────────────────────────────
extern String inputString;
extern bool   stringComplete;

// ─── Bidirectional Measurement State ─────────────────────────────────────────
extern MeasurementState measState;
extern FirstSensor      firstSensor;
extern unsigned long    firstTriggerUs;
extern unsigned long    measurementStartMs;
extern unsigned long    lastMeasurementEndMs;

// ─── Lap Timer State ──────────────────────────────────────────────────────────
extern LapMode            lapMode;
extern LapSessionState    lapSessionState;
extern LapDirectionFilter lapDirectionFilter;
extern unsigned long      lapStartUs;       // µs timestamp of lap start (= firstTriggerUs)
extern float              lapStartSpeedKmH;
extern int                lapNumber;
extern bool               lapAutoFlash;     // when true, ESP fires flash autonomously at lap boundary

// ─── Non-blocking Flash State ─────────────────────────────────────────────────
extern bool          flashActive;
extern unsigned long flashStartMs;

// ─── Speed Measurement Results ────────────────────────────────────────────────
extern float speedInKmH;
extern float speedTolerance;
