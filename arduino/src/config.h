#pragma once

// ─── Pin Configuration ────────────────────────────────────────────────────────
// NOTE: GPIO16 (D0) does not support hardware interrupts on the ESP8266.
// Both sensors are polled in the main loop; direction is determined by which
// sensor fires first. This is sufficient because the main loop polls on the
// order of µs, well below the minimum inter-sensor time at maximum speed.
constexpr int sensor1  = 16; // GPIO 16, D0
constexpr int sensor2  = 12; // GPIO 12, D6
constexpr int flashPin = 13; // GPIO 13, D7

// ─── Fixed Constants ──────────────────────────────────────────────────────────
constexpr float sensorDistance    = 135.0f; // Distance between light barriers (mm)
constexpr int   maxSpeedHardCap   = 250;    // Hard cap — readings above this are discarded (km/h)
constexpr long  measuringInterval = 2500;   // Measurement window timeout (ms)
constexpr long  cooldownMs        = 500;    // Cooldown between measurements (ms)
constexpr long  minPassUs         = 500;    // Min valid inter-sensor time (µs) — noise/simultaneous guard
