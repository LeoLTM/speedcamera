#pragma once
#include <Arduino.h>

// ─── Speed Camera / Status ────────────────────────────────────────────────────
void sendJsonStatus(const char *status);
void sendJsonStatus(const char *status, float value, float tolerance, const char *direction);

// ─── Config Acknowledgements ─────────────────────────────────────────────────
void sendJsonConfig(const char *key, float value);
void sendJsonConfigError(const char *message);

// ─── Ping / Pong ─────────────────────────────────────────────────────────────
void sendJsonPong();

// ─── Lap Timer ───────────────────────────────────────────────────────────────
void sendLapStart(int lapNum, float speedAtStart);
void sendLapEnd(int lapNum, float durationMs, float speedAtStart, float speedAtEnd);

// ─── Debug ───────────────────────────────────────────────────────────────────
void sendDebug(const String &message);
