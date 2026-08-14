#!/usr/bin/env bun
import { spawn } from "child_process";
import { existsSync } from "fs";

console.log("Starting speedcamera headless-rust server in mock mode on port 3099...");

const binaryPath = existsSync("./target/release/headless-rust")
  ? "./target/release/headless-rust"
  : existsSync("./target/debug/headless-rust")
  ? "./target/debug/headless-rust"
  : "cargo";

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

  // 4. Test WebSocket RPC
  console.log("Testing WebSocket RPC on ws://127.0.0.1:3099/ws/rpc ...");
  const ws = new WebSocket("ws://127.0.0.1:3099/ws/rpc");

  await new Promise<void>((resolve, reject) => {
    let settingsOk = false;
    let violationsOk = false;

    ws.onopen = () => {
      console.log("WebSocket connected successfully!");
      // Send RPC request for getSettings
      ws.send(JSON.stringify({ id: 1, method: "getSettings", params: {} }));
      // Send RPC request for getViolations
      ws.send(JSON.stringify({ id: 2, method: "getViolations", params: { page: 1, limit: 10 } }));
    };

    ws.onmessage = (event) => {
      console.log("WS message received:", event.data);
      const data = JSON.parse(event.data);

      if (data.id === 1) {
        console.log("RPC getSettings result:", data.result);
        if (data.result && typeof data.result.maxSpeed === "number") {
          settingsOk = true;
          console.log("SUCCESS: Settings RPC validated!");
        } else {
          reject(new Error("Unexpected getSettings response"));
        }
      }

      if (data.id === 2) {
        console.log("RPC getViolations result:", data.result);
        if (data.result && Array.isArray(data.result.violations)) {
          violationsOk = true;
          console.log("SUCCESS: Violations RPC validated!");
        } else {
          reject(new Error("Unexpected getViolations response"));
        }
      }

      if (settingsOk && violationsOk) {
        ws.close();
        resolve();
      }
    };

    ws.onerror = (err) => reject(err);
    setTimeout(() => reject(new Error("WS Timeout")), 8000);
  });

  console.log("\n=========================================================");
  console.log(" ALL INTEGRATION TESTS PASSED SUCCESSFULLY!");
  console.log("=========================================================");
} finally {
  proc.kill();
}
process.exit(0);
