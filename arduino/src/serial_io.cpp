#include "serial_io.h"
#include "state.h"
#include "json_output.h"
#include "modules/laptimer.h"
#include "modules/alignment.h"

// ─── Serial Input ─────────────────────────────────────────────────────────────
void handleSerial() {
  if (Serial.available() > 0 && Serial.peek() == '{' && inputString.length() > 0) {
    inputString    = "";
    stringComplete = false;
  }

  while (Serial.available()) {
    char inChar = (char)Serial.read();

    if (inChar == '{' && inputString.length() > 0) {
      inputString = "";
    }

    inputString += inChar;

    if (inChar == '}') {
      stringComplete = true;
      break;
    }
  }
}

void decodeJson(String &str) {
  str.trim();

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, str);

  // Clear state before handling so re-entrant handleSerial() calls are safe
  inputString    = "";
  stringComplete = false;

  if (error) {
    sendJsonStatus("jsonError");
    return;
  }

  handleCommand(doc);
}

// ─── Command Dispatch ─────────────────────────────────────────────────────────
void handleCommand(JsonDocument &doc) {
  const char *command = doc["command"] | "";

  if (strcmp(command, "setMaxSpeed") == 0) {
    float val = doc["value"] | -1.0f;
    if (val < 1.0f || val > 250.0f) {
      sendJsonConfigError("setMaxSpeed out of range [1,250]");
      return;
    }
    maxSpeedKmH = val;
    sendJsonConfig("maxSpeed", maxSpeedKmH);

  } else if (strcmp(command, "setDebug") == 0) {
    int val = doc["value"] | -1;
    if (val != 0 && val != 1) {
      sendJsonConfigError("setDebug value must be 0 or 1");
      return;
    }
    debugEnabled = (val == 1);
    sendJsonConfig("debug", debugEnabled ? 1.0f : 0.0f);

  } else if (strcmp(command, "ping") == 0) {
    sendJsonPong();

  } else if (strcmp(command, "getCapabilities") == 0) {
    sendJsonCapabilities();

  // ponytail: route module-specific commands without bloated registry abstractions
  } else if (LapTimer::handleCommand(command, doc)) {
    return;

  } else if (Alignment::handleCommand(command, doc)) {
    return;

  } else {
    sendJsonStatus("jsonError");
  }
}
