#include "alignment.h"
#include "../config.h"
#include "../json_output.h"

namespace Alignment {

// ponytail: private module state isolated in compilation unit
static bool active = false;
static bool reportedSensor1 = false;
static bool reportedSensor2 = false;
static unsigned long lastSendMs = 0;

static void sendBarrierStatus(bool s1, bool s2) {
  JsonDocument doc;
  doc["status"] = "barrierStatus";
  doc["s1"]     = s1;
  doc["s2"]     = s2;
  serializeJson(doc, Serial);
  Serial.println();
}

void init() {
  reset();
}

void reset() {
  active          = false;
  reportedSensor1 = false;
  reportedSensor2 = false;
  lastSendMs      = 0;
}

bool isActive() {
  return active;
}

void update() {
  // ponytail: 0 CPU cycles when dormant
  if (!active) {
    return;
  }

  unsigned long now = millis();
  bool s1 = (digitalRead(sensor1) == HIGH);
  bool s2 = (digitalRead(sensor2) == HIGH);
  bool dirty = (s1 != reportedSensor1 || s2 != reportedSensor2);

  // Send immediately on change (throttled to 25ms), or periodic 200ms heartbeat
  if ((dirty && (now - lastSendMs >= 25)) || (now - lastSendMs >= 200)) {
    reportedSensor1 = s1;
    reportedSensor2 = s2;
    lastSendMs      = now;
    sendBarrierStatus(s1, s2);
  }
}

void populatePongConfig(JsonObject &cfg) {
  cfg["alignmentActive"] = active;
}

bool handleCommand(const char *command, const JsonDocument &doc) {
  (void)doc;
  if (strcmp(command, "startAlignment") == 0) {
    active     = true;
    lastSendMs = 0; // Trigger immediate status on next update
    sendJsonStatus("alignmentReady");
    return true;
  } else if (strcmp(command, "stopAlignment") == 0) {
    reset();
    sendJsonStatus("alignmentStopped");
    return true;
  }
  return false;
}

} // namespace Alignment
