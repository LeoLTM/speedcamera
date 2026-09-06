#pragma once
#include <Arduino.h>

// ─── Speed Camera / Status ────────────────────────────────────────────────────
void sendJsonStatus(const char *status);
void sendJsonStatus(const char *status, float value, float tolerance, const char *direction);

// ─── Config Acknowledgements ─────────────────────────────────────────────────
void sendJsonConfig(const char *key, float value);
void sendJsonConfigError(const char *message);

// ─── Ping / Capabilities ─────────────────────────────────────────────────────
void sendJsonPong();
void sendJsonCapabilities();

// ─── Debug ───────────────────────────────────────────────────────────────────
void sendDebug(const String &message);
