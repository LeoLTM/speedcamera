#include "json_output.h"
#include <ArduinoJson.h>
#include "config.h"
#include "state.h"

#include "modules/laptimer.h"

// ─── Serial Output Helpers ────────────────────────────────────────────────────
// Serial.flush() is intentionally omitted for most messages: the TX FIFO
// buffers them at 115200 baud while the loop continues polling sensors.
// The pong response is the only message that warrants a flush (so the host
// receives the full config reply before the next command is processed).

void sendJsonStatus(const char *status) {
  JsonDocument doc;
  doc["status"] = status;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonStatus(const char *status, float value, float tolerance, const char *direction) {
  JsonDocument doc;
  doc["status"]    = status;
  doc["value"]     = round(value     * 10.0f) / 10.0f;
  doc["tolerance"] = round(tolerance * 10.0f) / 10.0f;
  doc["direction"] = direction;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonConfig(const char *key, float value) {
  JsonDocument doc;
  doc["status"] = "config";
  doc["key"]    = key;
  doc["value"]  = value;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonConfigError(const char *message) {
  JsonDocument doc;
  doc["status"]  = "configError";
  doc["message"] = message;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendJsonPong() {
  JsonDocument doc;
  doc["status"] = "pong";
  JsonObject cfg = doc["config"].to<JsonObject>();
  cfg["maxSpeed"]       = maxSpeedKmH;
  cfg["sensorDistance"] = sensorDistance;
  cfg["debugEnabled"]   = debugEnabled;
  LapTimer::populatePongConfig(cfg);
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
  Serial.flush(); // Ensure full pong reply is sent before next command is processed
}

void sendJsonCapabilities() {
  JsonDocument doc;
  doc["status"] = "capabilities";
  JsonArray features = doc["features"].to<JsonArray>();
  features.add("speed");
  features.add("laptimer");
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendDebug(const String &message) {
  if (!debugEnabled) return;
  JsonDocument doc;
  doc["debug"] = message;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}
