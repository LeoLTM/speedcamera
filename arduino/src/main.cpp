#include <Arduino.h>

const int sensor1 = 16; // GPIO 16, D0
const int sensor2 = 12; // GPIO 12, D6
const int flashPin = 13; // GPIO 13, D7

const int debounceTime = 50;           // Milliseconds for debounce
const float sensorDistance = 345.0f;  // Millimeters
const float maxSpeedKmH = 2;          // Speed limit in km/h
const long measuringInterval = 2500;  // Maximum time for measurement (ms)
const int flashTime = 100;            // Flash duration (ms)

unsigned long lastSensor1Time = 0;
unsigned long lastSensor2Time = 0;
float speedInKmH = 0.0f;
bool hasFlashed = false;

void handleSerial();
void flashLED();
void waitForFlash();

void setup() {
  Serial.begin(115200);
  pinMode(sensor1, INPUT_PULLUP);
  pinMode(sensor2, INPUT_PULLUP);
  pinMode(flashPin, OUTPUT);
  Serial.println("Setup done.");
}

void loop() {
  // Check for incoming serial commands
  handleSerial();

  // Sensor 1 triggered
  if (digitalRead(sensor1) == HIGH && (millis() - lastSensor1Time > debounceTime)) {
    lastSensor1Time = millis();
    unsigned long timer1 = lastSensor1Time;

    Serial.println("1"); // Start measurement

    while (millis() - timer1 < measuringInterval) {
      // Check if Sensor 2 is triggered
      if (digitalRead(sensor2) == HIGH && (millis() - lastSensor2Time > debounceTime)) {
        lastSensor2Time = millis();
        float passingTime = lastSensor2Time - timer1; // Time in ms
        speedInKmH = (sensorDistance / passingTime) * 3.6f;
        String speedStr = String(speedInKmH, 1);

        if (speedInKmH > maxSpeedKmH) {
          Serial.println("3" + speedStr); // Trigger flash command
          waitForFlash();
        } else {
          Serial.println("2"); // No flash needed
        }
        return;
      }
    }

    // Timeout, no valid measurement
    Serial.println("0"); // Back to idle
  }
}

// Handle incoming serial commands
void handleSerial() {
  if (Serial.available() > 0) {
    char command = Serial.read();
    if (command == '5') {
      flashLED();
    }
  }
}

// Trigger the flash
void flashLED() {
  digitalWrite(flashPin, HIGH);
  delay(flashTime);
  digitalWrite(flashPin, LOW);
}

// Wait for confirmation to trigger the flash
void waitForFlash() {
  while (!Serial.available()) {
    // Wait for "5" response
  }
  if (Serial.read() == '5') {
    delay(400);
    flashLED();
  }
}
