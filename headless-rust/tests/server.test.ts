// Integration tests against the daemon in mock mode: HTTP endpoints, Socket.io RPC and live events.
// Run with `bun run test:integration` (builds the debug binary first), or point
// SPEEDCAMERA_BIN at a prebuilt binary and run `bun test tests`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";

const PORT = Number(process.env.SPEEDCAMERA_TEST_PORT ?? 3099);
const BASE = `http://127.0.0.1:${PORT}`;
const BIN = process.env.SPEEDCAMERA_BIN ?? join(import.meta.dir, "..", "target", "debug", "headless-rust");

let server: ChildProcess;
let socket: Socket;
let dataDir: string;
let serverLog = "";

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const resp: any = await socket.timeout(3000).emitWithAck("rpc", { method, params });
  if (resp?.error) throw new Error(`${method}: ${resp.error}`);
  return resp.result;
}

function nextEvent<T = any>(event: string, timeoutMs: number, accept: (payload: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`no '${event}' event within ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (!accept(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

beforeAll(async () => {
  if (!existsSync(BIN)) {
    throw new Error(`Daemon binary not found at ${BIN}. Run \`cargo build\` or set SPEEDCAMERA_BIN.`);
  }
  // Throwaway data dir so test violations never land in a developer's real database.
  dataDir = mkdtempSync(join(tmpdir(), "speedcamera-test-"));
  server = spawn(BIN, ["--mock", "--port", String(PORT)], {
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: "pipe",
  });
  server.stdout?.on("data", (d) => (serverLog += d));
  server.stderr?.on("data", (d) => (serverLog += d));

  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    if (server.exitCode !== null) break;
    await Bun.sleep(250);
  }
  if (server.exitCode !== null || !(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false))) {
    throw new Error(`Daemon did not become healthy on port ${PORT}:\n${serverLog}`);
  }

  socket = io(BASE, { transports: ["websocket"], timeout: 5000 });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
});

afterAll(() => {
  socket?.disconnect();
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("HTTP", () => {
  test("health reports status and version", async () => {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    expect(health.status).toBe("ok");
    expect(health.mockMode).toBe(true);
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("network summary is served", async () => {
    const res = await fetch(`${BASE}/api/network`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toBeObject();
  });

  test("SPA index.html is served", async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain("<html");
  });
});

describe("Socket.io RPC", () => {
  test("ping", async () => {
    const pong: any = await socket.timeout(3000).emitWithAck("ping");
    expect(pong?.pong).toBeTruthy();
  });

  test("settings and violations", async () => {
    expect((await rpc("getSettings")).maxSpeed).toBeNumber();
    expect((await rpc("getViolations", { page: 1, limit: 10 })).violations).toBeArray();
  });

  test("arming", async () => {
    expect((await rpc("getArmedState")).armed).toBeBoolean();
    expect((await rpc("setArmed", { armed: true })).armed).toBe(true);
  });

  test("local version matches health", async () => {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    expect((await rpc("getLocalVersion")).version).toBe(health.version);
  });

  test("laptimer plugin RPC", async () => {
    const plugins = await rpc("getPlugins");
    expect(plugins.some((p: any) => p.id === "laptimer")).toBe(true);

    const session = await rpc("createLapSession", { lapMode: "single" });
    expect(session.id).toBeNumber();
    await rpc("deleteLapSession", { id: session.id });
  });
});

describe("live events", () => {
  test("setup stream pushes live frames", async () => {
    const frame = nextEvent<string>("liveFrame", 5000);
    await rpc("startSetupStream");
    try {
      expect((await frame).length).toBeGreaterThan(0);
    } finally {
      await rpc("stopSetupStream");
    }
  });

  test("saved violation is broadcast", async () => {
    const violation = nextEvent<any>("violation", 5000, (v) => v.measuredSpeed === 67.5);
    await rpc("saveViolation", { measuredSpeed: 67.5, maxSpeed: 30.0, direction: "approaching" });
    expect((await violation).id).toBeNumber();
  });
});
