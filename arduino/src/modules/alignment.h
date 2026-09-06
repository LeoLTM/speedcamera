#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "../types.h"

// ponytail: static modular Alignment. Zero heap, zero vtables, 0 CPU when dormant.
namespace Alignment {

void init();
void reset();
bool isActive();
void update();

void populatePongConfig(JsonObject &cfg);
bool handleCommand(const char *command, const JsonDocument &doc);

} // namespace Alignment
