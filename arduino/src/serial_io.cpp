#include "serial_io.h"
#include "state.h"
#include "json_output.h"
#include "flash.h"

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

  if (strcmp(command, "flash") == 0) {
    delay(waitBeforeFlash);
    flashLED();

  } else if (strcmp(command, "setMaxSpeed") == 0) {
    float val = doc["value"] | -1.0f;
    if (val < 1.0f || val > 250.0f) {
      sendJsonConfigError("setMaxSpeed out of range [1,250]");
      return;
    }
    maxSpeedKmH = val;
    sendJsonConfig("maxSpeed", maxSpeedKmH);

  } else if (strcmp(command, "setFlashDelay") == 0) {
    float val = doc["value"] | -1.0f;
    if (val < 0.0f || val > 5000.0f) {
      sendJsonConfigError("setFlashDelay out of range [0,5000]");
      return;
    }
    waitBeforeFlash = (int)val;
    sendJsonConfig("flashDelay", (float)waitBeforeFlash);

  } else if (strcmp(command, "setFlashDuration") == 0) {
    float val = doc["value"] | -1.0f;
    if (val < 1.0f || val > 10000.0f) {
      sendJsonConfigError("setFlashDuration out of range [1,10000]");
      return;
    }
    flashTime = (int)val;
    sendJsonConfig("flashDuration", (float)flashTime);

  } else if (strcmp(command, "setDebug") == 0) {
    int val = doc["value"] | -1;
    if (val != 0 && val != 1) {
      sendJsonConfigError("setDebug value must be 0 or 1");
      return;
    }
    debugEnabled = (val == 1);
    sendJsonConfig("debug", debugEnabled ? 1.0f : 0.0f);

  } else if (strcmp(command, "startLapSession") == 0) {
    const char *modeStr = doc["mode"] | "single";
    lapMode = (strcmp(modeStr, "multi") == 0) ? LapMode::MULTI : LapMode::SINGLE;

    // autoFlash: ESP fires flash autonomously at lap boundaries (default true)
    lapAutoFlash = doc["autoFlash"] | true;

    // dirFilter: which crossing directions advance the lap state machine
    const char *dirStr = doc["dirFilter"] | "both";
    if      (strcmp(dirStr, "forward") == 0) lapDirectionFilter = LapDirectionFilter::FORWARD_ONLY;
    else if (strcmp(dirStr, "reverse") == 0) lapDirectionFilter = LapDirectionFilter::REVERSE_ONLY;
    else                                      lapDirectionFilter = LapDirectionFilter::BOTH;

    lapSessionState  = LapSessionState::WAITING;
    lapNumber        = 1;
    lapStartUs       = 0;
    lapStartSpeedKmH = 0.0f;
    sendJsonStatus("lapWaiting");

  } else if (strcmp(command, "stopLapSession") == 0) {
    lapSessionState  = LapSessionState::IDLE;
    lapNumber        = 1;
    lapStartUs       = 0;
    lapStartSpeedKmH = 0.0f;
    sendJsonStatus("lapStopped");

  } else if (strcmp(command, "ping") == 0) {
    sendJsonPong();

  } else {
    sendJsonStatus("jsonError");
  }
}

// ─── Blocking Flash Wait ──────────────────────────────────────────────────────
// Used in speed camera mode only. Blocks until the host sends {"command":"flash"}
// or the 500 ms guard window expires.
void waitForFlash() {
  unsigned long startTime = millis();
  while (millis() - startTime < 500) {
    handleSerial();
    if (stringComplete) {
      decodeJson(inputString);
      break;
    }
    yield();
  }
}
