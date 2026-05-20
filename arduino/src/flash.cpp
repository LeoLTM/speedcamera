#include "flash.h"
#include <Arduino.h>
#include "config.h"
#include "state.h"
#include "json_output.h"

// Non-blocking flash — for lap timer mode.
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
