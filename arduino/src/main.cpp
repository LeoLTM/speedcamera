#include <Arduino.h>
#include <ArduinoJson.h>

const int sensor1 = 16; // GPIO 16, D0
const int sensor2 = 12; // GPIO 12, D6
const int flashPin = 13; // GPIO 13, D7

const int debounceTime = 1000;           // Milliseconds for debounce per sensor
const int cooldownAfterMeasurement = 500; // Milliseconds to wait after a measurement
const float sensorDistance = 325.0f;  // Millimeters
      float maxSpeedKmH = 2;          // Speed limit in km/h
const long measuringInterval = 2500;  // Maximum time for measurement (ms)
const int flashTime = 50;            // Flash duration (ms)
const int waitBeforeFlash = 100;      // Wait time before flash (ms) to sync with the camera
const int maxSpeed = 200;             // Maximum speed in km/h

unsigned long lastSensor1Time = 0;
unsigned long lastSensor2Time = 0;
float speedInKmH = 0.0f;
bool hasFlashed = false;

bool stringComplete = false;          // Whether the string is complete
String inputString = "";              // A string to hold the incoming data

void handleSerial();
void decodeJson(String inputString);
void handleCommand(JsonDocument doc);
void sendJsonStatus(String status);
void sendJsonStatus(String status, float value);
void sendDebug(String message);
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
  // Update serial input
  handleSerial();
  // Check for JSON command
  if (stringComplete) {
    decodeJson(inputString);
  }

  // Sensor 1 triggered
  if (
        digitalRead(sensor1) == HIGH 
        && (millis() - lastSensor1Time > debounceTime) 
        && (millis() - lastSensor2Time > cooldownAfterMeasurement)
        ) {
    lastSensor1Time = millis();
    unsigned long timer1 = lastSensor1Time;

    sendJsonStatus("measuring"); // Start measurement

    while (millis() - timer1 < measuringInterval) {
      // Check if Sensor 2 is triggered
      if (digitalRead(sensor2) == HIGH && (millis() - lastSensor2Time > debounceTime)) {
        lastSensor2Time = millis();
        float passingTime = lastSensor2Time - timer1; // Time in ms
        speedInKmH = (sensorDistance / passingTime) * 3.6f;
        String speedStr = String(speedInKmH, 1);

        if ((speedInKmH > maxSpeedKmH) && (speedInKmH > 0.0f) && (speedInKmH < maxSpeed)) {
          sendJsonStatus("speeding", speedInKmH); // Trigger flash command
          waitForFlash();
        } else {
          sendJsonStatus("legal", speedInKmH); // No flash needed
        }
        return;
      }
      yield(); // Feed the watchdog
    }

    // Timeout, no valid measurement
    sendJsonStatus("timeout"); // Back to idle
  }
}

void handleSerial() {
  // If we're receiving a new command when a previous one hasn't been processed
  // reset the input string to avoid concatenation
  if (Serial.available() > 0 && Serial.peek() == '{' && inputString.length() > 0) {
    inputString = "";
  }


  while(Serial.available()) {
    // get the new byte:
    char inChar = (char)Serial.read();

    // if we see the start of a new JSON object and already have data
    // clear the string to start fresh
    if (inChar == '{' && inputString.length() > 0) {
      inputString = "";
    }

    // Add the character to the input string
    inputString += inChar;

    // if the incoming character is the end of a JSON object
    if (inChar == '}') {
      stringComplete = true;
      break; // Exit to process this complete JSON object
    }
  }
}

void decodeJson(String inputString) {
  // Clear any whitespace characters
  inputString.trim();

  // Parse JSON
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, inputString);

  // Check for errors
  if (error) {
    sendJsonStatus("jsonError");
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.c_str());
    return;
  }
  String command = doc["command"];

  // Handle the command
  handleCommand(doc);
  
  // Clear the string
  inputString = "";
  stringComplete = false;
}

void handleCommand(JsonDocument doc) {
  String command = doc["command"];
  if(command.equals("setMaxSpeed")) {
    float newMaxSpeedKmH = doc["value"].as<float>();
    maxSpeedKmH = newMaxSpeedKmH;
    sendJsonStatus("config", maxSpeedKmH);
  }
  if (command.equals("flash")) {
    delay(waitBeforeFlash);
    flashLED();
  }
}

void sendJsonStatus(String status) {
  JsonDocument doc;
  doc["status"] = status;
  String output;
  serializeJson(doc, output);
  // Add a newline to the end of the message
  output += "\n";
  
  // Use a single write operation for the entire message
  Serial.write(output.c_str(), output.length());
  Serial.flush();
}

void sendJsonStatus(String status, float value) {
  JsonDocument doc;
  doc["status"] = status;
  doc["value"] = round(value * 10) / 10.0;
  String output;
  serializeJson(doc, output);
  // Add a newline to the end of the message
  output += "\n";
  
  // Use a single write operation for the entire message
  Serial.write(output.c_str(), output.length());
  Serial.flush();
}

void sendDebug(String message) {
  JsonDocument doc;
  doc["debug"] = message;
  String output;
  serializeJson(doc, output);
  // Add a newline to the end of the message
  output += "\n";

  // Use a single write operation for the entire message
  Serial.write(output.c_str(), output.length());
  Serial.flush();
}

// Trigger the flash
void flashLED() {
  sendJsonStatus("flash");
  digitalWrite(flashPin, HIGH);
  delay(flashTime);
  digitalWrite(flashPin, LOW);
}

// Wait for confirmation to trigger the flash
void waitForFlash() {
  unsigned long startTime = millis();
  // Wait for JSON response up to 500ms
  while (millis() - startTime < 500) { 
    handleSerial();
    
    // Check if we received a complete JSON message
    if (stringComplete) {
      decodeJson(inputString);
      break;
    }
    yield(); // Feed the watchdog
  }
  // Note: The actual flash trigger now happens in decodeJson when command="flash"
}

// Meaning of command numbers:
// 0: Idle
// 1: Start measurement
// 2: No flash needed
// 3: Flash needed
// 5: Trigger flash

// Meaning of JSON status:
// measuring: Start measurement
// legal: No flash needed
// speeding: Flash needed
// timeout: No valid measurement
// jsonError: JSON parsing error
// config: Configuration received

// Meaning of JSON command:
// flash: Trigger flash
// setMaxSpeed: Set maximum speed limit