#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "../types.h"

// ponytail: static modular LapTimer. Zero dynamic memory allocation, zero vtables.
namespace LapTimer {

enum class LapMode            : uint8_t { SINGLE, MULTI };
enum class LapSessionState    : uint8_t { IDLE, WAITING, TIMING };
enum class LapDirectionFilter : uint8_t { BOTH, FORWARD_ONLY, REVERSE_ONLY };

void init();
void reset();
bool isActive();
void update();

// Query helpers for pong response
void populatePongConfig(JsonObject &cfg);

// Command handler — returns true if command recognized & consumed
bool handleCommand(const char *command, const JsonDocument &doc);

// Hardware event hook — called when a valid speed measurement occurs
void onMeasurement(const MeasurementEvent &event);

} // namespace LapTimer
