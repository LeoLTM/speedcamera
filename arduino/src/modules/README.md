# ESP Firmware Module Architecture Guide (`arduino/src/modules`)

This guide explains how AI software development agents and embedded developers structure and implement feature modules for the ESP8266/ESP32 firmware companion.

For backend and frontend plugins on the host side, see:
- Backend: [`headless-rust/src/plugins/README.md`](../../../headless-rust/src/plugins/README.md)
- Frontend: [`headless-rust/frontend/src/plugins/README.md`](../../../headless-rust/frontend/src/plugins/README.md)

---

## 1. Architectural Principles

1. **Monolithic Companion Firmware:**
   - Single firmware binary flashed once at factory/setup.
   - All modules compiled into firmware. Zero reflashing required when host adds, removes, or toggles features.
2. **Dormant by Default:**
   - Modules remain completely inactive until host sends activation command (e.g. `startLapSession`).
   - While dormant: consume 0 CPU cycles and 0 serial bandwidth.
3. **Zero Dynamic Allocation (Ponytail / YAGNI):**
   - **NO `malloc`, `new`, `std::vector`, or `std::function`.**
   - Avoid dynamic heap fragmentation on ESP8266/ESP32 microcontrollers.
   - No virtual function tables or polymorphic base class overhead.
   - Use static C++ namespaces or static classes.
4. **Deterministic Timing Integrity:**
   - Core beam-break polling loop in `main.cpp` runs at sub-10µs precision.
   - Modules must never perform blocking operations, busy loops, or long `delay()` calls during `onMeasurement()`.

---

## 2. Directory Layout

Feature modules reside inside `arduino/src/modules/`:

```
arduino/src/
├── config.h             # Pins & hardware timing constants
├── types.h              # MeasurementEvent struct & core enums
├── state.h / state.cpp  # Core hardware state ONLY (no module state)
├── json_output.h / .cpp # Core JSON serialization & capabilities
├── serial_io.h / .cpp   # Serial buffer reading & command routing
├── main.cpp             # Hardware polling loop (<10µs) & event dispatch
└── modules/
    ├── README.md        # This guide
    ├── laptimer.h       # LapTimer module header
    ├── laptimer.cpp     # LapTimer state machine & serial output
    ├── example.h        # Future module header
    └── example.cpp      # Future module implementation
```

---

## 3. The Module Contract

A module is implemented as a C++ namespace (or static class) exposing the standard interface:

```cpp
// arduino/src/modules/example.h
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "../types.h"

namespace ExampleModule {

void init();
void reset();
bool isActive();

// Optional: populate fields in the ping/pong response for backward compat
void populatePongConfig(JsonObject &cfg);

// Command handler: returns true if command is handled by this module
bool handleCommand(const char *command, const JsonDocument &doc);

// Event hook: called when a passing vehicle triggers both sensors
void onMeasurement(const MeasurementEvent &event);

} // namespace ExampleModule
```

### The `MeasurementEvent` Struct

Defined in [`arduino/src/types.h`](../types.h):

```cpp
struct MeasurementEvent {
  float speedKmH;            // Calculated speed in km/h
  float toleranceKmH;        // Resolution uncertainty in km/h
  const char *direction;     // "forward" | "reverse"
  unsigned long boundaryUs;  // µs timestamp of the first beam break
};
```

---

## 4. Step-by-Step Implementation Guide

### Step 1: Define Header (`modules/<module_name>.h`)

Declare module enums, state machine types, and the module interface:

```cpp
// arduino/src/modules/calibration.h
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "../types.h"

namespace Calibration {

enum class CalibrationState : uint8_t { IDLE, RUNNING };

void init();
void reset();
bool isActive();
void populatePongConfig(JsonObject &cfg);
bool handleCommand(const char *command, const JsonDocument &doc);
void onMeasurement(const MeasurementEvent &event);

} // namespace Calibration
```

### Step 2: Implement Logic & Local State (`modules/<module_name>.cpp`)

Keep state private to the compilation unit using `static`:

```cpp
// arduino/src/modules/calibration.cpp
#include "calibration.h"
#include "../json_output.h"

namespace Calibration {

static CalibrationState state = CalibrationState::IDLE;

void init() {
  reset();
}

void reset() {
  state = CalibrationState::IDLE;
}

bool isActive() {
  return state != CalibrationState::IDLE;
}

void populatePongConfig(JsonObject &cfg) {
  cfg["calibrationActive"] = isActive();
}

bool handleCommand(const char *command, const JsonDocument &doc) {
  if (strcmp(command, "startCalibration") == 0) {
    state = CalibrationState::RUNNING;
    sendJsonStatus("calibrationReady");
    return true;
  } else if (strcmp(command, "stopCalibration") == 0) {
    reset();
    sendJsonStatus("calibrationStopped");
    return true;
  }
  return false;
}

void onMeasurement(const MeasurementEvent &event) {
  if (!isActive()) return;

  // Process measurement for calibration...
  JsonDocument outDoc;
  outDoc["status"] = "calibrationPass";
  outDoc["speed"]  = event.speedKmH;
  serializeJson(outDoc, Serial);
  Serial.println();
}

} // namespace Calibration
```

### Step 3: Register in Command Dispatcher (`serial_io.cpp`)

Delegate unrecognized serial commands to your module:

```cpp
// In handleCommand() in arduino/src/serial_io.cpp:
#include "modules/calibration.h"

// ...
} else if (LapTimer::handleCommand(command, doc)) {
  return;
} else if (Calibration::handleCommand(command, doc)) {
  return;
} else {
  sendJsonStatus("jsonError");
}
```

### Step 4: Register in Event Dispatch & Lifecycle (`main.cpp`)

1. Call `init()` in `setup()`:
   ```cpp
   Calibration::init();
   ```

2. Forward `MeasurementEvent` in `loop()`:
   ```cpp
   LapTimer::onMeasurement(event);
   Calibration::onMeasurement(event);
   ```

### Step 5: Update Capability List (`json_output.cpp`)

Add feature identifier to `sendJsonCapabilities()`:

```cpp
void sendJsonCapabilities() {
  JsonDocument doc;
  doc["status"] = "capabilities";
  JsonArray features = doc["features"].to<JsonArray>();
  features.add("speed");
  features.add("laptimer");
  features.add("calibration"); // <-- Add new feature
  // ...
}
```

---

## 5. Verification Checklist for AI Agents

Before completing any firmware module refactoring or addition:

- [ ] Zero global variables added to `state.h` or `state.cpp`. Module state is `static` inside `modules/<name>.cpp`.
- [ ] No heap allocations (`malloc`, `new`, `new[]`) used.
- [ ] `handleCommand` returns `true` only for handled commands, `false` otherwise.
- [ ] `getCapabilities` output updated to include feature name.
- [ ] `onMeasurement` exits immediately if module is inactive (`isActive() == false`).
- [ ] JSON strings formatted with line ending `\n` to match companion framing.
