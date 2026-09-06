#include <Arduino.h>
#include "config.h"
#include "state.h"
#include "json_output.h"
#include "serial_io.h"
#include "modules/laptimer.h"
#include "modules/alignment.h"

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
  LapTimer::init();
  Alignment::init();
  sendJsonStatus("ready");
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
void loop() {
  LapTimer::update();
  Alignment::update();

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
      MeasurementEvent event = { speedInKmH, speedTolerance, direction, boundaryUs };

      // Base speed status (speeding or legal)
      if (speedInKmH > maxSpeedKmH) {
        sendJsonStatus("speeding", speedInKmH, speedTolerance, direction);
      } else {
        sendJsonStatus("legal", speedInKmH, speedTolerance, direction);
      }

      // ponytail: notify active modules with zero heap allocation or dynamic dispatch
      LapTimer::onMeasurement(event);

    } else {
      sendJsonStatus("timeout"); // Speed out of valid range — discard
    }
  }

  yield();
}

// ─── Protocol Reference ───────────────────────────────────────────────────────
//
// SYSTEM / CORE
//   Out: speeding {value, tolerance, direction} | legal {value, tolerance, direction}
//        timeout | measuring | ready | pong | config | configError | jsonError
//        capabilities {features: [...]}
//   In:  setMaxSpeed {value:1–250}     — set speed limit
//        setDebug {value:0|1}
//        ping
//        getCapabilities
//
// MODULE: LAP TIMER (dormant until startLapSession received)
//   Out: lapWaiting                    — session opened, awaiting first pass
//        lapStopped                    — session closed by host
//        lapStart {lapNumber, speedAtStart}              — first beam break
//        lapEnd   {lapNumber, durationMs, speedAtStart, speedAtEnd}  — lap closed
//        speeding / legal still emitted (UI speed display)
//   In:  startLapSession {mode, dirFilter?}  — open session
//        stopLapSession                      — close session
//
// startLapSession optional fields:
//   dirFilter:  "both" | "forward" | "reverse"  (default "both")

