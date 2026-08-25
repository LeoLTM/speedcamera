#!/usr/bin/env bun
import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { io } from "socket.io-client";

console.log("Starting speedcamera headless-rust server in mock mode on port 3099 for live event testing...");

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
  const socket = io("http://127.0.0.1:3099", {
    transports: ["websocket", "polling"],
    timeout: 5000,
  });

  await new Promise<void>((resolve, reject) => {
    const testTimer = setTimeout(() => reject(new Error("Live events test timed out after 15s")), 15000);

    let receivedLiveFrames = 0;
    let receivedViolation = false;
    let setupStreamActive = false;

    socket.on("connect", async () => {
      console.log("Socket.io connected successfully! Testing live events...");

      socket.on("liveFrame", (b64Frame) => {
        receivedLiveFrames++;
        console.log(`[EVENT] Received liveFrame #${receivedLiveFrames} (length: ${b64Frame?.length || 0})`);
      });

      socket.on("violation", (violation) => {
        console.log(`[EVENT] Received violation event: ID #${violation.id} (${violation.measuredSpeed} km/h)`);
        receivedViolation = true;
      });

      socket.on("cameraStatus", (status) => {
        console.log("[EVENT] Received cameraStatus:", status);
        if (status.isStreaming) {
          setupStreamActive = true;
        }
      });

      try {
        // 1. Arm the system
        console.log("Arming system...");
        await socket.emitWithAck("rpc", { method: "setArmed", params: { armed: true } });

        // 2. Start Setup Stream
        console.log("Starting setup preview stream via RPC...");
        await socket.emitWithAck("rpc", { method: "startSetupStream", params: {} });

        // Wait 1.5 seconds for frames to arrive
        await new Promise((r) => setTimeout(r, 1500));

        if (receivedLiveFrames === 0) {
          throw new Error("No live frames received from setup stream!");
        }
        console.log(`SUCCESS: Received ${receivedLiveFrames} live preview frames over Socket.io!`);

        // 3. Trigger a violation via saveViolation RPC
        console.log("Triggering violation via saveViolation RPC...");
        const saveResp: any = await socket.emitWithAck("rpc", {
          method: "saveViolation",
          params: {
            measuredSpeed: 67.5,
            maxSpeed: 30.0,
            direction: "approaching",
          },
        });
        console.log("saveViolation RPC response:", saveResp);

        // Wait 500ms for broadcast to arrive
        await new Promise((r) => setTimeout(r, 500));

        if (!receivedViolation) {
          throw new Error("Violation push broadcast was not received over Socket.io!");
        }
        console.log("SUCCESS: Violation push broadcast received over Socket.io!");

        // 4. Stop setup stream
        console.log("Stopping setup stream...");
        await socket.emitWithAck("rpc", { method: "stopSetupStream", params: {} });

        clearTimeout(testTimer);
        socket.disconnect();
        resolve();
      } catch (err) {
        clearTimeout(testTimer);
        socket.disconnect();
        reject(err);
      }
    });

    socket.on("connect_error", (err) => {
      clearTimeout(testTimer);
      reject(err);
    });
  });

  console.log("\n=========================================================");
  console.log(" ALL LIVE EVENTS & PREVIEW STREAM CHECKS PASSED!");
  console.log("=========================================================");
} finally {
  proc.kill();
}
process.exit(0);
