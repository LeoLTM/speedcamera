#include "state.h"

// ─── Configurable Parameters ─────────────────────────────────────────────────
float maxSpeedKmH     = 2.0f;
bool  debugEnabled    = false;

// ─── Serial Input State ───────────────────────────────────────────────────────
String inputString    = "";
bool   stringComplete = false;

// ─── Bidirectional Measurement State ─────────────────────────────────────────
MeasurementState measState            = MeasurementState::IDLE;
FirstSensor      firstSensor          = FirstSensor::NONE;
unsigned long    firstTriggerUs       = 0;
unsigned long    measurementStartMs   = 0;
unsigned long    lastMeasurementEndMs = 0;

// ─── Lap Timer State ──────────────────────────────────────────────────────────
LapMode            lapMode            = LapMode::SINGLE;
LapSessionState    lapSessionState    = LapSessionState::IDLE;
LapDirectionFilter lapDirectionFilter = LapDirectionFilter::BOTH;
unsigned long      lapStartUs         = 0;
float              lapStartSpeedKmH   = 0.0f;
int                lapNumber          = 1;


// ─── Speed Measurement Results ────────────────────────────────────────────────
float speedInKmH    = 0.0f;
float speedTolerance = 0.0f;
