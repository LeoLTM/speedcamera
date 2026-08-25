#!/usr/bin/env bun
import { spawn } from "child_process";
import { existsSync } from "fs";
import { io } from "socket.io-client";

console.log("Starting speedcamera headless-rust server in mock mode on port 3099...");

import { statSync } from "fs";

let binaryPath = "cargo";
const relPath = "./target/release/headless-rust";
const dbgPath = "./target/debug/headless-rust";

if (existsSync(relPath) && existsSync(dbgPath)) {
  binaryPath = statSync(relPath).mtimeMs > statSync(dbgPath).mtimeMs ? relPath : dbgPath;
} else if (existsSync(relPath)) {
  binaryPath = relPath;
} else if (existsSync(dbgPath)) {
  binaryPath = dbgPath;
}

const args = binaryPath === "cargo"
  ? ["run", "--", "--mock", "--port", "3099"]
  : ["--mock", "--port", "3099"];

const proc = spawn(binaryPath, args, {
  cwd: process.cwd(),
  stdio: "pipe",
});

proc.stdout?.on("data", (data) => console.log(`[server stdout] ${data}`));
proc.stderr?.on("data", (data) => console.error(`[server stderr] ${data}`));

// Wait up to 15s for server to start
let ready = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch("http://127.0.0.1:3099/api/health");
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {}
}

if (!ready) {
  proc.kill();
  console.error("Server failed to start within timeout.");
  process.exit(1);
}

try {
  // 1. Test Health endpoint
  console.log("Testing GET http://127.0.0.1:3099/api/health ...");
  const healthRes = await fetch("http://127.0.0.1:3099/api/health");
  const healthData = await healthRes.json();
  console.log("Health response:", healthData);
  if (healthData.status !== "ok") throw new Error("Health check failed");

  // 2. Test Network endpoint
  console.log("Testing GET http://127.0.0.1:3099/api/network ...");
  const netRes = await fetch("http://127.0.0.1:3099/api/network");
  const netData = await netRes.json();
  console.log("Network status:", netData.status);

  // 3. Test SPA index.html
  console.log("Testing GET http://127.0.0.1:3099/ ...");
  const indexRes = await fetch("http://127.0.0.1:3099/");
  const indexHtml = await indexRes.text();
  if (!indexHtml.includes("<!DOCTYPE html>") && !indexHtml.includes("<html")) {
    throw new Error("SPA index.html not served");
  }
  console.log("SPA index.html served correctly! Length:", indexHtml.length);

  // 4. Test Socket.io RPC and initial broadcasts
  console.log("Testing Socket.io on http://127.0.0.1:3099 ...");
  const socket = io("http://127.0.0.1:3099", {
    transports: ["websocket", "polling"],
    timeout: 5000,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket.io test timed out")), 10000);

    let initialCameraStatusReceived = false;
    let initialSerialStatusReceived = false;

    socket.on("cameraStatus", (status) => {
      console.log("Push event received: cameraStatus", status);
      initialCameraStatusReceived = true;
    });

    socket.on("serialStatus", (status) => {
      console.log("Push event received: serialStatus", status);
      initialSerialStatusReceived = true;
    });

    socket.on("connect", async () => {
      console.log("Socket.io connected successfully! Socket ID:", socket.id);

      try {
        // Test RPC: ping
        const pingResp: any = await socket.timeout(3000).emitWithAck("ping");
        console.log("Ping response:", pingResp);
        if (!pingResp?.pong) throw new Error("Ping failed");

        // Test RPC: getSettings
        const settingsResp: any = await socket.timeout(3000).emitWithAck("rpc", { method: "getSettings", params: {} });
        console.log("RPC getSettings response:", settingsResp);
        if (settingsResp.error || typeof settingsResp.result?.maxSpeed !== "number") {
          throw new Error("getSettings RPC failed");
        }
        console.log("SUCCESS: Settings RPC validated!");

        // Test RPC: getViolations
        const violationsResp: any = await socket.timeout(3000).emitWithAck("rpc", { method: "getViolations", params: { page: 1, limit: 10 } });
        console.log("RPC getViolations response:", violationsResp);
        if (violationsResp.error || !Array.isArray(violationsResp.result?.violations)) {
          throw new Error("getViolations RPC failed");
        }
        console.log("SUCCESS: Violations RPC validated!");

        // Test RPC: getArmedState
        const armedStateResp: any = await socket.timeout(3000).emitWithAck("rpc", { method: "getArmedState", params: {} });
        console.log("RPC getArmedState response:", armedStateResp);
        if (armedStateResp.error || typeof armedStateResp.result?.armed !== "boolean") {
          throw new Error("getArmedState RPC failed");
        }

        // Test RPC: setArmed
        const setArmedResp: any = await socket.timeout(3000).emitWithAck("rpc", { method: "setArmed", params: { armed: true } });
        console.log("RPC setArmed response:", setArmedResp);
        if (setArmedResp.error || setArmedResp.result?.armed !== true) {
          throw new Error("setArmed RPC failed");
        }
        console.log("SUCCESS: Armed RPC validated!");

        clearTimeout(timer);
        socket.disconnect();
        resolve();
      } catch (err) {
        clearTimeout(timer);
        socket.disconnect();
        reject(err);
      }
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  console.log("\n=========================================================");
  console.log(" ALL SOCKET.IO INTEGRATION TESTS PASSED SUCCESSFULLY!");
  console.log("=========================================================");
} finally {
  proc.kill();
}
process.exit(0);
