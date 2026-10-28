#include "laptimer.h"
#include "../json_output.h"

namespace LapTimer {

// ponytail: random per boot, so the host never subtracts boundaries from two different ESP boots
static uint32_t bootId = 0;
static bool     active = false;

// ─── Internal Serial Output ──────────────────────────────────────────────────
// t:   first beam break on the ESP's 64-bit µs clock (lap durations are differences of t)
// age: µs between the beam break and this line being written; the host subtracts it from its
//      receive time to place the crossing on the wall clock
static void sendLapCrossing(const MeasurementEvent &event) {
  JsonDocument doc;
  doc["status"]    = "lapCrossing";
  // micros64() is the core's wrap-safe 64-bit clock; micros() is its low 32 bits, so the
  // wrapping 32-bit difference is the exact age even across a micros() rollover.
  const uint64_t nowUs = micros64();
  const uint32_t ageUs = (uint32_t)nowUs - (uint32_t)event.boundaryUs;
  doc["t"]         = nowUs - ageUs;
  doc["age"]       = ageUs;
  doc["boot"]      = bootId;
  doc["speed"]     = serialized(String(event.speedKmH, 1));
  doc["direction"] = event.direction;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

// ─── Public API ──────────────────────────────────────────────────────────────
void init() {
  bootId = ESP.random();
  reset();
}

void reset() {
  active = false;
}

bool isActive() {
  return active;
}

void populatePongConfig(JsonObject &cfg) {
  // Host-side lap chaining: lapMode and lapDirFilter live on the host now
  cfg["lapMode"]      = "host";
  cfg["lapActive"]    = active;
  cfg["lapDirFilter"] = "both";
  cfg["lapCrossing"]  = true;
}

bool handleCommand(const char *command, const JsonDocument &doc) {
  (void)doc;
  if (strcmp(command, "startLapSession") == 0) {
    active = true;
    sendJsonStatus("lapWaiting");
    return true;

  } else if (strcmp(command, "stopLapSession") == 0) {
    active = false;
    sendJsonStatus("lapStopped");
    return true;
  }

  return false;
}

void onMeasurement(const MeasurementEvent &event) {
  if (!active) {
    return;
  }
  sendLapCrossing(event);
}

} // namespace LapTimer
