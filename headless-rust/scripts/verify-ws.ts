#!/usr/bin/env bun
console.log("Connecting to WebSocket on ws://127.0.0.1:3000/ws/rpc ...");
const ws = new WebSocket("ws://127.0.0.1:3000/ws/rpc");

let receivedCameraPush = false;
let receivedSettingsResponse = false;
let receivedViolationsResponse = false;

ws.onopen = () => {
  console.log("[WS] Connected to Speedcamera Headless Rust Daemon!");
  // 1. Request getSettings
  ws.send(JSON.stringify({ id: 101, method: "getSettings", params: {} }));
  // 2. Request getViolations
  ws.send(JSON.stringify({ id: 102, method: "getViolations", params: { page: 1, limit: 10 } }));
};

ws.onmessage = (event) => {
  console.log("[WS] Message received:", event.data);
  const data = JSON.parse(event.data);

  if (data.event === "cameraStatus") {
    receivedCameraPush = true;
    console.log("-> Push message 'cameraStatus' verified!");
  }

  if (data.id === 101) {
    if (data.result && typeof data.result.maxSpeed === "number") {
      receivedSettingsResponse = true;
      console.log("-> RPC 'getSettings' verified! Max speed:", data.result.maxSpeed);
    }
  }

  if (data.id === 102) {
    if (data.result && Array.isArray(data.result.violations)) {
      receivedViolationsResponse = true;
      console.log("-> RPC 'getViolations' verified! Total violations:", data.result.total);
    }
  }

  if (receivedSettingsResponse && receivedViolationsResponse) {
    console.log("\n>>> ALL WEBSOCKET RPC CHECKS PASSED PERFECTLY! <<<");
    ws.close();
    process.exit(0);
  }
};

ws.onerror = (err) => {
  console.error("WS error:", err);
  process.exit(1);
};

setTimeout(() => {
  console.error("Test timeout after 5s");
  process.exit(1);
}, 5000);
