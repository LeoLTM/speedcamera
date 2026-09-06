#include "laptimer.h"
#include "../json_output.h"

namespace LapTimer {

// ponytail: private module state isolated from global namespace
static LapSessionState    sessionState    = LapSessionState::IDLE;
static LapMode            lapMode         = LapMode::SINGLE;
static LapDirectionFilter directionFilter = LapDirectionFilter::BOTH;
static unsigned long      lapStartUs      = 0;
static float              lapStartSpeedKmH = 0.0f;
static int                lapNumber       = 1;

// ─── Internal Serial Output ──────────────────────────────────────────────────
static void sendLapStart(int lapNum, float speedAtStart) {
  JsonDocument doc;
  doc["status"]       = "lapStart";
  doc["lapNumber"]    = lapNum;
  doc["speedAtStart"] = serialized(String(speedAtStart, 1));
  serializeJson(doc, Serial);
  Serial.println();
}

static void sendLapEnd(int lapNum, float durationMs, float speedAtStart, float speedAtEnd) {
  JsonDocument doc;
  doc["status"]       = "lapEnd";
  doc["lapNumber"]    = lapNum;
  doc["durationMs"]   = serialized(String(durationMs, 1));
  doc["speedAtStart"] = serialized(String(speedAtStart, 1));
  doc["speedAtEnd"]   = serialized(String(speedAtEnd, 1));
  serializeJson(doc, Serial);
  Serial.println();
}

// ─── Public API ──────────────────────────────────────────────────────────────
void init() {
  reset();
}

void reset() {
  sessionState     = LapSessionState::IDLE;
  lapMode          = LapMode::SINGLE;
  directionFilter  = LapDirectionFilter::BOTH;
  lapStartUs       = 0;
  lapStartSpeedKmH = 0.0f;
  lapNumber        = 1;
}

bool isActive() {
  return sessionState != LapSessionState::IDLE;
}

void populatePongConfig(JsonObject &cfg) {
  cfg["lapMode"]      = (lapMode == LapMode::MULTI) ? "multi" : "single";
  cfg["lapActive"]    = (sessionState != LapSessionState::IDLE);
  cfg["lapDirFilter"] = (directionFilter == LapDirectionFilter::FORWARD_ONLY) ? "forward"
                      : (directionFilter == LapDirectionFilter::REVERSE_ONLY) ? "reverse" : "both";
}

bool handleCommand(const char *command, const JsonDocument &doc) {
  if (strcmp(command, "startLapSession") == 0) {
    const char *modeStr = doc["mode"] | "single";
    lapMode = (strcmp(modeStr, "multi") == 0) ? LapMode::MULTI : LapMode::SINGLE;

    const char *dirStr = doc["dirFilter"] | "both";
    if      (strcmp(dirStr, "forward") == 0) directionFilter = LapDirectionFilter::FORWARD_ONLY;
    else if (strcmp(dirStr, "reverse") == 0) directionFilter = LapDirectionFilter::REVERSE_ONLY;
    else                                     directionFilter = LapDirectionFilter::BOTH;

    sessionState     = LapSessionState::WAITING;
    lapNumber        = 1;
    lapStartUs       = 0;
    lapStartSpeedKmH = 0.0f;
    sendJsonStatus("lapWaiting");
    return true;

  } else if (strcmp(command, "stopLapSession") == 0) {
    sessionState     = LapSessionState::IDLE;
    lapNumber        = 1;
    lapStartUs       = 0;
    lapStartSpeedKmH = 0.0f;
    sendJsonStatus("lapStopped");
    return true;
  }

  return false;
}

void onMeasurement(const MeasurementEvent &event) {
  if (sessionState == LapSessionState::IDLE) {
    return;
  }

  // Direction filter check
  bool passValid = (directionFilter == LapDirectionFilter::BOTH)
                || (directionFilter == LapDirectionFilter::FORWARD_ONLY && strcmp(event.direction, "forward") == 0)
                || (directionFilter == LapDirectionFilter::REVERSE_ONLY && strcmp(event.direction, "reverse") == 0);

  if (!passValid) {
    return;
  }

  if (sessionState == LapSessionState::WAITING) {
    // ── WAITING → TIMING: open lap N ──────────────────────────────────────────
    lapStartUs       = event.boundaryUs; // µs-precise first beam break
    lapStartSpeedKmH = event.speedKmH;
    sessionState     = LapSessionState::TIMING;
    sendLapStart(lapNumber, event.speedKmH);

  } else if (sessionState == LapSessionState::TIMING) {
    // ── TIMING: close lap N ────────────────────────────────────────────────────
    float lapDurationMs = (float)(event.boundaryUs - lapStartUs) * 0.001f;
    sendLapEnd(lapNumber, lapDurationMs, lapStartSpeedKmH, event.speedKmH);

    if (lapMode == LapMode::SINGLE) {
      sessionState     = LapSessionState::WAITING;
      lapNumber        = 1;
      lapStartUs       = 0;
      lapStartSpeedKmH = 0.0f;

    } else {
      // MULTI: this crossing closes lap N and opens lap N+1 without time gap
      lapStartUs       = event.boundaryUs;
      lapStartSpeedKmH = event.speedKmH;
      lapNumber++;
      // sessionState stays TIMING
      sendLapStart(lapNumber, event.speedKmH);
    }
  }
}

} // namespace LapTimer
