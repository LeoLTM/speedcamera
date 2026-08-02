#include <Arduino.h>
#include "config.h"
#include "state.h"
#include "json_output.h"
#include "serial_io.h"

// ─── State Reset ─────────────────────────────────────────────────────────────
void resetMeasurement() {
  measState            = MeasurementState::IDLE;
  firstSensor          = FirstSensor::NONE;
  firstTriggerUs       = 0;
  lastMeasurementEndMs = millis();
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(sensor1,  INPUT_PULLUP);
  pinMode(sensor2,  INPUT_PULLUP);
  sendJsonStatus("ready");
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
void loop() {
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
        } else {
          sendJsonStatus("legal", speedInKmH, speedTolerance, direction);
        }

      // ================================================================
      // LAP TIMER MODE  (active lap session)
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
            // ── WAITING → TIMING: open lap N ────────────────────────────────
            lapStartUs       = boundaryUs; // µs-precise first beam break
            lapStartSpeedKmH = speedInKmH;
            lapSessionState  = LapSessionState::TIMING;
            sendLapStart(lapNumber, speedInKmH);

          } else if (lapSessionState == LapSessionState::TIMING) {
            // ── TIMING: close lap N ──────────────────────────────────────────
            float lapDurationMs = (float)(boundaryUs - lapStartUs) * 0.001f;
            sendLapEnd(lapNumber, lapDurationMs, lapStartSpeedKmH, speedInKmH);

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

// ─── Protocol Reference ───────────────────────────────────────────────────────
//
// SPEED CAMERA MODE (lapSessionState == IDLE)
//   Out: speeding {value, tolerance, direction} | legal {value, tolerance, direction}
//        timeout | measuring | ready | pong | config | configError | jsonError
//   In:  setMaxSpeed {value:1–250}     — set speed limit
//        setDebug {value:0|1}
//        ping
//
// LAP TIMER MODE (lapSessionState != IDLE)
//   Out: lapWaiting                    — session opened, awaiting first pass
//        lapStopped                    — session closed by host
//        lapStart {lapNumber, speedAtStart}              — first beam break
//        lapEnd   {lapNumber, durationMs, speedAtStart, speedAtEnd}  — lap closed
//        speeding / legal still emitted (UI speed display)
//   In:  startLapSession {mode, dirFilter?}  — open session
//        stopLapSession                                   — close session
//
// startLapSession optional fields:
//   dirFilter:  "both" | "forward" | "reverse"  (default "both")
