#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

void handleSerial();
void decodeJson(String &str);
void handleCommand(JsonDocument &doc);

// Wait for host to send {"command":"flash"} — host controls exact flash timing
void waitForFlash();
