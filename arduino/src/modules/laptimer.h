#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "../types.h"

// ponytail: static modular LapTimer. Zero dynamic memory allocation, zero vtables.
// The ESP only reports crossings with a µs-precise 64-bit boundary; the host chains them into
// laps, so it can drop false triggers (e.g. someone walking through) without breaking a lap.
namespace LapTimer {

void init();
void reset();
bool isActive();

// Query helpers for pong response
void populatePongConfig(JsonObject &cfg);

// Command handler — returns true if command recognized & consumed
bool handleCommand(const char *command, const JsonDocument &doc);

// Hardware event hook — called when a valid speed measurement occurs
void onMeasurement(const MeasurementEvent &event);

} // namespace LapTimer
