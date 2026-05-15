#include <Arduino.h>
#include <ArduinoJson.h>

// ─── Pin Configuration ───────────────────────────────────────────────────────
// NOTE: GPIO16 (D0) does not support hardware interrupts on the ESP8266.
// Both sensors are polled in the main loop; direction is determined by which
// sensor fires first. This is sufficient because the main loop polls on the
// order of µs, well below the minimum inter-sensor time at maximum speed.
const int sensor1  = 16; // GPIO 16, D0
const int sensor2  = 12; // GPIO 12, D6
const int flashPin = 13; // GPIO 13, D7

// ─── Fixed Constants ─────────────────────────────────────────────────────────
const float sensorDistance    = 135.0f; // Distance between light barriers (mm)
const int   maxSpeedHardCap   = 250;    // Hard cap — readings above this are discarded (km/h)
const long  measuringInterval = 2500;   // Measurement window timeout (ms)
const long  cooldownMs        = 500;    // Cooldown between measurements (ms)
const long  minPassUs         = 500;    // Min valid inter-sensor time (µs) — noise/simultaneous guard

// ─── Configurable Parameters (adjustable via serial commands) ────────────────
float maxSpeedKmH    = 2.0f; // Speed limit (km/h)
int   flashTime      = 50;   // Flash duration (ms)
int   waitBeforeFlash = 100; // Pre-flash delay (ms) for camera sync
bool  debugEnabled   = false; // Enable verbose debug JSON output

// ─── Serial Input State ───────────────────────────────────────────────────────
String inputString    = "";
bool   stringComplete = false;

// ─── Bidirectional Measurement State Machine ──────────────────────────────────
// Either sensor can be the "first" trigger. The sensor that fires first
// determines direction; the second sensor completes the measurement.
// This eliminates the phantom ~230 km/h reading caused by reverse-direction
// passes, which the old code could not handle.
enum class MeasurementState : uint8_t { IDLE, WAITING_FOR_SECOND };
enum class FirstSensor      : uint8_t { NONE, SENSOR_ONE, SENSOR_TWO };

// ─── Lap Timer State Machine ──────────────────────────────────────────────────
// The host starts/stops a lap session via serial commands.  Once a session is
// active the firmware drives the state machine: the first car pass opens a
// lap (WAITING → TIMING) and the second car pass closes it (TIMING → WAITING
// for SINGLE mode, or TIMING → TIMING with an incremented counter for MULTI).
// durationMs is computed here with millis() for maximum accuracy.
enum class LapMode            : uint8_t { SINGLE, MULTI };
enum class LapSessionState    : uint8_t { IDLE, WAITING, TIMING };
enum class LapDirectionFilter : uint8_t { BOTH, FORWARD_ONLY, REVERSE_ONLY };

LapMode            lapMode            = LapMode::SINGLE;
LapSessionState    lapSessionState    = LapSessionState::IDLE;
LapDirectionFilter lapDirectionFilter = LapDirectionFilter::BOTH;
unsigned long      lapStartUs         = 0;  // µs timestamp of lap start (= firstTriggerUs)
float              lapStartSpeedKmH   = 0.0f;
int                lapNumber          = 1;
bool               lapAutoFlash       = true; // when true, ESP fires flash autonomously at lap boundary

MeasurementState measState            = MeasurementState::IDLE;
FirstSensor      firstSensor          = FirstSensor::NONE;
unsigned long    firstTriggerUs       = 0;
unsigned long    measurementStartMs   = 0;
unsigned long    lastMeasurementEndMs = 0;

// ─── Non-blocking Flash State ─────────────────────────────────────────────────
// Used in lap timer mode only. flashLED() remains for speed camera mode.
bool          flashActive  = false;
unsigned long flashStartMs = 0;

float speedInKmH   = 0.0f;
float speedTolerance = 0.0f;

// ─── Function Declarations ───────────────────────────────────────────────────
void handleSerial();
void decodeJson(String &str);
void handleCommand(JsonDocument &doc);
void sendJsonStatus(const char *status);
void sendJsonStatus(const char *status, float value, float tolerance, const char *direction);
void sendJsonConfig(const char *key, float value);
void sendJsonConfigError(const char *message);
void sendJsonPong();
void sendLapStart(int lapNum, float speedAtStart);
void sendLapEnd(int lapNum, float durationMs, float speedAtStart, float speedAtEnd);
void sendDebug(const String &message);
void startNonBlockingFlash();
void flashLED();
void waitForFlash();
void resetMeasurement();

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(sensor1,  INPUT_PULLUP);
  pinMode(sensor2,  INPUT_PULLUP);
  pinMode(flashPin, OUTPUT);
  digitalWrite(flashPin, LOW);
  sendJsonStatus("ready");
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
void loop() {  // ── Non-blocking flash tick ────────────────────────────────────────────────
  // Runs every iteration (µs-level) so flash duration is accurate without blocking.
  if (flashActive && (millis() - flashStartMs >= (unsigned long)flashTime)) {
    digitalWrite(flashPin, LOW);
    flashActive = false;
  }
  // Process incoming serial commands every iteration
  handleSerial();
  if (stringComplete) {
    decodeJson(inputString);
  }

  // ── IDLE: wait for either sensor to trigger ──────────────────────────────
  if (measState == MeasurementState::IDLE) {
    if (millis() - lastMeasurementEndMs < (unsigned long)cooldownMs) {
      yield();
      return;
    }

    if (digitalRead(sensor1) == HIGH) {
      firstTriggerUs     = micros();
      firstSensor        = FirstSensor::SENSOR_ONE;
      measurementStartMs = millis();
      measState          = MeasurementState::WAITING_FOR_SECOND;
      sendJsonStatus("measuring");
    } else if (digitalRead(sensor2) == HIGH) {
      firstTriggerUs     = micros();
      firstSensor        = FirstSensor::SENSOR_TWO;
      measurementStartMs = millis();
      measState          = MeasurementState::WAITING_FOR_SECOND;
      sendJsonStatus("measuring");
    }

    yield();
    return;
  }

  // ── WAITING_FOR_SECOND: listen for the complementary sensor ─────────────
  if (millis() - measurementStartMs > (unsigned long)measuringInterval) {
    resetMeasurement();
    sendJsonStatus("timeout");
    yield();
    return;
  }

  // Only poll the sensor that did NOT trigger first
  int targetPin = (firstSensor == FirstSensor::SENSOR_ONE) ? sensor2 : sensor1;

  if (digitalRead(targetPin) == HIGH) {
    unsigned long secondTriggerUs = micros();
    unsigned long deltaUs         = secondTriggerUs - firstTriggerUs;

    // Reject simultaneous / noise triggers (impossible at > maxSpeedHardCap anyway)
    if (deltaUs < (unsigned long)minPassUs) {
      resetMeasurement();
      sendJsonStatus("timeout");
      yield();
      return;
    }

    float passingTimeMs = (float)deltaUs / 1000.0f;
    speedInKmH          = (sensorDistance / passingTimeMs) * 3.6f;

    // Tolerance from micros() resolution (±4 µs per read → ±8 µs total)
    // Δv [km/h] = v_ms² × 8e-6 / d_m × 3.6
    float speedMs     = speedInKmH / 3.6f;
    float sensorDistM = sensorDistance / 1000.0f;
    speedTolerance    = (speedMs * speedMs * 8.0e-6f / sensorDistM) * 3.6f;

    const char *direction = (firstSensor == FirstSensor::SENSOR_ONE) ? "forward" : "reverse";

    if (debugEnabled) {
      sendDebug(
        String("delta=") + String(deltaUs) + "us v=" + String(speedInKmH, 1) +
        "km/h tol=" + String(speedTolerance, 2) + "km/h dir=" + direction
      );
    }

    // Snapshot firstTriggerUs BEFORE resetMeasurement() clears it to 0.
    // This is the µs-precise timestamp of the first beam break — used as the
    // lap boundary in timer mode.
    const unsigned long boundaryUs = firstTriggerUs;

    resetMeasurement();

    if (speedInKmH > 0.0f && speedInKmH < (float)maxSpeedHardCap) {

      // ================================================================
      // SPEED CAMERA MODE  (no active lap session)
      // Behavior unchanged: host-controlled flash, violation tracking.
      // ================================================================
      if (lapSessionState == LapSessionState::IDLE) {
        if (speedInKmH > maxSpeedKmH) {
          sendJsonStatus("speeding", speedInKmH, speedTolerance, direction);
          waitForFlash(); // blocking — host must send {"command":"flash"}
        } else {
          sendJsonStatus("legal", speedInKmH, speedTolerance, direction);
        }

      // ================================================================
      // LAP TIMER MODE  (active lap session)
      // waitForFlash() is NEVER called — lap timing must never block.
      // Flash fires autonomously via startNonBlockingFlash().
      // Lap boundaries are firstTriggerUs (µs-precise first beam break),
      // captured before any serial output or state change.
      // ================================================================
      } else {
        // Emit speed event for UI display only — no blocking call follows
        if (speedInKmH > maxSpeedKmH) {
          sendJsonStatus("speeding", speedInKmH, speedTolerance, direction);
        } else {
          sendJsonStatus("legal", speedInKmH, speedTolerance, direction);
        }

        // Direction filter — configured per session
        bool passValid = (lapDirectionFilter == LapDirectionFilter::BOTH)
                      || (lapDirectionFilter == LapDirectionFilter::FORWARD_ONLY && strcmp(direction, "forward") == 0)
                      || (lapDirectionFilter == LapDirectionFilter::REVERSE_ONLY && strcmp(direction, "reverse") == 0);

        if (passValid) {
          if (lapSessionState == LapSessionState::WAITING) {
            // ── WAITING → TIMING: open lap N ──────────────────────────────────
            lapStartUs       = boundaryUs; // µs-precise first beam break
            lapStartSpeedKmH = speedInKmH;
            lapSessionState  = LapSessionState::TIMING;
            sendLapStart(lapNumber, speedInKmH);
            if (lapAutoFlash) startNonBlockingFlash();

          } else if (lapSessionState == LapSessionState::TIMING) {
            // ── TIMING: close lap N ────────────────────────────────────────────
            float lapDurationMs = (float)(boundaryUs - lapStartUs) * 0.001f;
            sendLapEnd(lapNumber, lapDurationMs, lapStartSpeedKmH, speedInKmH);
            if (lapAutoFlash) startNonBlockingFlash();

            if (lapMode == LapMode::SINGLE) {
              lapSessionState  = LapSessionState::WAITING;
              lapNumber        = 1;
              lapStartUs       = 0;
              lapStartSpeedKmH = 0.0f;

            } else {
              // MULTI: this same boundary crossing closes lap N and opens lap N+1.
              // Reuse boundaryUs so there is zero gap between consecutive laps.
              lapStartUs       = boundaryUs;
              lapStartSpeedKmH = speedInKmH;
              lapNumber++;
              // lapSessionState stays TIMING
              sendLapStart(lapNumber, speedInKmH); // resets host live timer immediately
            }
          }
        }
      }

    } else {
      sendJsonStatus("timeout"); // Speed out of valid range — discard
    }
  }

  yield();
}

// ─── State Reset ─────────────────────────────────────────────────────────────
void resetMeasurement() {
  measState            = MeasurementState::IDLE;
  firstSensor          = FirstSensor::NONE;
  firstTriggerUs       = 0;
  lastMeasurementEndMs = millis();
}

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

// ─── JSON Output Helpers ──────────────────────────────────────────────────────
// Serial.flush() is intentionally omitted for most messages: the TX FIFO
// buffers them at 115200 baud while the loop continues polling sensors.
// The pong response is the only message that warrants a flush (so the host
// receives the full config reply before the next command is processed).

void sendJsonStatus(const char *status) {
  JsonDocument doc;
  doc["status"] = status;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonStatus(const char *status, float value, float tolerance, const char *direction) {
  JsonDocument doc;
  doc["status"]    = status;
  doc["value"]     = round(value     * 10.0f) / 10.0f;
  doc["tolerance"] = round(tolerance * 10.0f) / 10.0f;
  doc["direction"] = direction;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonConfig(const char *key, float value) {
  JsonDocument doc;
  doc["status"] = "config";
  doc["key"]    = key;
  doc["value"]  = value;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

// ─── Lap Timer Output Helpers ──────────────────────────────────────────────────

void sendLapStart(int lapNum, float speedAtStart) {
  JsonDocument doc;
  doc["status"]       = "lapStart";
  doc["lapNumber"]    = lapNum;
  doc["speedAtStart"] = round(speedAtStart * 10.0f) / 10.0f;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendLapEnd(int lapNum, float durationMs, float speedAtStart, float speedAtEnd) {
  JsonDocument doc;
  doc["status"]       = "lapEnd";
  doc["lapNumber"]    = lapNum;
  doc["durationMs"]   = durationMs; // full float precision (~0.001 ms)
  doc["speedAtStart"] = round(speedAtStart * 10.0f) / 10.0f;
  doc["speedAtEnd"]   = round(speedAtEnd   * 10.0f) / 10.0f;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonConfigError(const char *message) {
  JsonDocument doc;
  doc["status"]  = "configError";
  doc["message"] = message;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonPong() {
  JsonDocument doc;
  doc["status"] = "pong";
  JsonObject cfg = doc["config"].to<JsonObject>();
  cfg["maxSpeed"]       = maxSpeedKmH;
  cfg["flashDelay"]     = waitBeforeFlash;
  cfg["flashDuration"]  = flashTime;
  cfg["sensorDistance"] = sensorDistance;
  cfg["debugEnabled"]   = debugEnabled;
  cfg["lapMode"]        = (lapMode == LapMode::MULTI) ? "multi" : "single";
  cfg["lapActive"]      = (lapSessionState != LapSessionState::IDLE);
  cfg["lapAutoFlash"]   = lapAutoFlash;
  cfg["lapDirFilter"]   = (lapDirectionFilter == LapDirectionFilter::FORWARD_ONLY) ? "forward"
                        : (lapDirectionFilter == LapDirectionFilter::REVERSE_ONLY) ? "reverse" : "both";
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
  Serial.flush(); // Ensure full pong reply is sent before next command is processed
}

void sendDebug(const String &message) {
  if (!debugEnabled) return;
  JsonDocument doc;
  doc["debug"] = message;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

// ─── Flash Control ────────────────────────────────────────────────────────────

// Non-blocking flash — for lap timer mode.
// GPIO goes HIGH immediately; the main-loop tick turns it LOW after flashTime ms.
// Lap timing precision is unaffected because this call returns in <1 µs.
void startNonBlockingFlash() {
  digitalWrite(flashPin, HIGH);
  flashStartMs = millis();
  flashActive  = true;
}

// Blocking flash — for speed camera mode (host-coordinated).
void flashLED() {
  sendJsonStatus("flash");
  digitalWrite(flashPin, HIGH);
  delay(flashTime);
  digitalWrite(flashPin, LOW);
}

// Wait for host to send {"command":"flash"} — host controls exact flash timing
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

// ─── Protocol Reference ───────────────────────────────────────────────────────
//
// SPEED CAMERA MODE (lapSessionState == IDLE)
//   Out: speeding {value, tolerance, direction} | legal {value, tolerance, direction}
//        timeout | measuring | flash | ready | pong | config | configError | jsonError
//   In:  flash                         — host triggers flash after "speeding"
//        setMaxSpeed {value:1–250}     — set speed limit
//        setFlashDelay {value:0–5000}  — pre-flash delay
//        setFlashDuration {value:1–10000}
//        setDebug {value:0|1}
//        ping
//
// LAP TIMER MODE (lapSessionState != IDLE)
//   Out: lapWaiting                    — session opened, awaiting first pass
//        lapStopped                    — session closed by host
//        lapStart {lapNumber, speedAtStart}              — first beam break
//        lapEnd   {lapNumber, durationMs, speedAtStart, speedAtEnd}  — lap closed
//        speeding / legal still emitted (UI speed display); no waitForFlash
//   In:  startLapSession {mode, autoFlash?, dirFilter?}  — open session
//        stopLapSession                                   — close session
//
// startLapSession optional fields:
//   autoFlash:  true | false                    (default true)  ESP fires flash at boundary
//   dirFilter:  "both" | "forward" | "reverse"  (default "both")