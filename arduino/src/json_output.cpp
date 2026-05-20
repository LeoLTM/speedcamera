#include "json_output.h"
#include <ArduinoJson.h>
#include "config.h"
#include "state.h"

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
  cfg["flashDelay"]     = waitBeforeFlash;
  cfg["flashDuration"]  = flashTime;
  cfg["sensorDistance"] = sensorDistance;
  cfg["debugEnabled"]   = debugEnabled;
  cfg["lapMode"]        = (lapMode == LapMode::MULTI) ? "multi" : "single";
  cfg["lapActive"]      = (lapSessionState != LapSessionState::IDLE);
  cfg["lapAutoFlash"]   = lapAutoFlash;
  cfg["lapDirFilter"]   = (lapDirectionFilter == LapDirectionFilter::FORWARD_ONLY) ? "forward"
                        : (lapDirectionFilter == LapDirectionFilter::REVERSE_ONLY) ? "reverse" : "both";
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
  Serial.flush(); // Ensure full pong reply is sent before next command is processed
}

void sendLapStart(int lapNum, float speedAtStart) {
  JsonDocument doc;
  doc["status"]       = "lapStart";
  doc["lapNumber"]    = lapNum;
  doc["speedAtStart"] = round(speedAtStart * 10.0f) / 10.0f;
  String out;
  serializeJson(doc, out);
  out += '\n';
  Serial.write(out.c_str(), out.length());
}

void sendLapEnd(int lapNum, float durationMs, float speedAtStart, float speedAtEnd) {
  JsonDocument doc;
  doc["status"]       = "lapEnd";
  doc["lapNumber"]    = lapNum;
  doc["durationMs"]   = durationMs; // full float precision (~0.001 ms)
  doc["speedAtStart"] = round(speedAtStart * 10.0f) / 10.0f;
  doc["speedAtEnd"]   = round(speedAtEnd   * 10.0f) / 10.0f;
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
