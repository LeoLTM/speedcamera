import { spawn } from "child_process";

console.log("Starting speedcamera headless server in mock mode...");
const proc = spawn("bun", ["src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, MOCK_MODE: "true", PORT: "3099" },
  stdio: "pipe",
});

proc.stdout?.on("data", (data) => console.log(`[server stdout] ${data}`));
proc.stderr?.on("data", (data) => console.error(`[server stderr] ${data}`));

// Wait 1s for server to start
await new Promise((r) => setTimeout(r, 1200));

try {
  // 1. Test Health endpoint
  console.log("Testing GET http://localhost:3099/api/health ...");
  const healthRes = await fetch("http://localhost:3099/api/health");
  const healthData = await healthRes.json();
  console.log("Health response:", healthData);
  if (healthData.status !== "ok") throw new Error("Health check failed");

  // 2. Test SPA index.html
  console.log("Testing GET http://localhost:3099/ ...");
  const indexRes = await fetch("http://localhost:3099/");
  const indexHtml = await indexRes.text();
  if (!indexHtml.includes("<!DOCTYPE html>")) throw new Error("SPA index.html not served");
  console.log("SPA index.html served correctly! Length:", indexHtml.length);

  // 3. Test WebSocket RPC
  console.log("Testing WebSocket RPC on ws://localhost:3099/ws/rpc ...");
  const ws = new WebSocket("ws://localhost:3099/ws/rpc");

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      console.log("WebSocket connected successfully!");
      // Send RPC request for getSettings
      ws.send(JSON.stringify({ id: 1, method: "getSettings", params: {} }));
    };

    ws.onmessage = (event) => {
      console.log("WS message received:", event.data);
      const data = JSON.parse(event.data);
      if (data.id === 1) {
        console.log("RPC getSettings result:", data.result);
        if (data.result && typeof data.result.maxSpeed === "number") {
          console.log("SUCCESS: Settings RPC validated!");
          resolve();
        } else {
          reject(new Error("Unexpected RPC response"));
        }
      }
    };

    ws.onerror = (err) => reject(err);
    setTimeout(() => reject(new Error("WS Timeout")), 5000);
  });

  console.log("ALL TESTS PASSED SUCCESSFULLY!");
} finally {
  proc.kill();
}
process.exit(0);
