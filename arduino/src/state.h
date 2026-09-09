#pragma once
#include <Arduino.h>
#include "config.h"
#include "types.h"

// ─── Configurable Parameters (adjustable via serial commands) ─────────────────
extern float maxSpeedKmH;     // Speed limit (km/h)
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

// ─── Speed Measurement Results ────────────────────────────────────────────────
extern float speedInKmH;
extern float speedTolerance;

// ─── Operating Mode State ─────────────────────────────────────────────────────
extern OperatingMode currentOpMode;
void resetMeasurement();


