#!/usr/bin/env bun
import { io } from "socket.io-client";

console.log("Connecting to Socket.io on http://127.0.0.1:3000 ...");
const socket = io("http://127.0.0.1:3000", {
  transports: ["websocket", "polling"],
  timeout: 5000,
});

let receivedCameraPush = false;
let receivedSettingsResponse = false;
let receivedViolationsResponse = false;

socket.on("connect", async () => {
  console.log("[Socket.io] Connected to Speedcamera Headless Rust Daemon! Socket ID:", socket.id);

  try {
    // 1. Request getSettings
    const settingsResp: any = await socket.timeout(3000).emitWithAck("rpc", { method: "getSettings", params: {} });
    if (settingsResp.result && typeof settingsResp.result.maxSpeed === "number") {
      receivedSettingsResponse = true;
      console.log("-> RPC 'getSettings' verified! Max speed:", settingsResp.result.maxSpeed);
    }

    // 2. Request getViolations
    const violationsResp: any = await socket.timeout(3000).emitWithAck("rpc", { method: "getViolations", params: { page: 1, limit: 10 } });
    if (violationsResp.result && Array.isArray(violationsResp.result.violations)) {
      receivedViolationsResponse = true;
      console.log("-> RPC 'getViolations' verified! Total violations:", violationsResp.result.total);
    }

    if (receivedSettingsResponse && receivedViolationsResponse) {
      console.log("\n>>> ALL SOCKET.IO RPC CHECKS PASSED PERFECTLY! <<<");
      socket.disconnect();
      process.exit(0);
    }
  } catch (err) {
    console.error("RPC error:", err);
    socket.disconnect();
    process.exit(1);
  }
});

socket.on("cameraStatus", (status) => {
  receivedCameraPush = true;
  console.log("-> Push message 'cameraStatus' verified:", status);
});

socket.on("connect_error", (err) => {
  console.error("Socket.io error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("Test timeout after 5s");
  process.exit(1);
}, 5000);
