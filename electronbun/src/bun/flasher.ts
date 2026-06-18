import { join } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";
import type { GithubRelease, FlashProgressPayload } from "../shared/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API_URL = "https://api.github.com/repos/LeoLTM/speedcamera/releases";
const GITHUB_USER_URL = "https://api.github.com/user";

// Only allow well-formed version tags from our own repo
const TAG_PATTERN = /^v\d+\.\d+\.\d+(-canary)?$/;

// ─── esptool binary path resolution ──────────────────────────────────────────
// Tries paths in order: packaged app, dev build layout, system PATH fallback

function resolveEsptoolPath(): string {
  const candidates = [
    join(import.meta.dir, "..", "resources", "esptool"),
    join(import.meta.dir, "..", "..", "resources", "esptool"),
  ];
  return candidates.find((p) => existsSync(p)) ?? "esptool";
}

const ESPTOOL_PATH = resolveEsptoolPath();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function githubHeaders(token: string, accept = "application/vnd.github+json"): HeadersInit {
  const h: HeadersInit = { Accept: accept, "User-Agent": "speedcamera-app" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// ─── Push callback ────────────────────────────────────────────────────────────

type PushFn = (payload: FlashProgressPayload) => void;
let _push: PushFn | null = null;

/** Register the RPC push function (called once from index.ts after window creation). */
export function initFlasher(push: PushFn): void {
  _push = push;
}

function push(payload: FlashProgressPayload): void {
  _push?.(payload);
}

// ─── Active process handle ────────────────────────────────────────────────────

let _activeProc: ReturnType<typeof Bun.spawn> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify that `token` has read access to the speedcamera releases.
 * Returns the GitHub login on success, or an error message on failure.
 */
export async function testGithubToken(
  token: string,
): Promise<{ valid: boolean; login?: string; error?: string }> {
  if (!token.trim()) {
    return { valid: false, error: "Token is empty" };
  }

  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API_URL}?per_page=1`, {
      headers: githubHeaders(token),
    });
  } catch (e) {
    return { valid: false, error: `Network error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (resp.status === 401) return { valid: false, error: "Invalid token — authentication failed" };
  if (resp.status === 403) return { valid: false, error: "Forbidden — check token scopes (needs repo read)" };
  if (resp.status === 404) return { valid: false, error: "Repository not found — check token permissions" };
  if (!resp.ok) return { valid: false, error: `GitHub API error: ${resp.status} ${resp.statusText}` };

  // Token works; also resolve the GitHub account name for confirmation
  let login: string | undefined;
  try {
    const userResp = await fetch(GITHUB_USER_URL, { headers: githubHeaders(token) });
    if (userResp.ok) {
      login = ((await userResp.json()) as { login: string }).login;
    }
  } catch {
    // Non-critical — token is still valid
  }

  return { valid: true, login };
}

/**
 * Fetch all releases for the speedcamera repo from the GitHub API.
 * Includes the API URL of the firmware.bin asset for each release so it can be
 * downloaded with auth (required for private repos).
 */
export async function listFirmwareReleases(token: string): Promise<GithubRelease[]> {
  const resp = await fetch(GITHUB_API_URL, { headers: githubHeaders(token) });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("GitHub authentication failed — check your token in the Firmware Update settings");
  }
  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as Array<{
    tag_name: string;
    name: string;
    published_at: string;
    prerelease: boolean;
    assets: Array<{ name: string; url: string }>;
  }>;

  return data.map((r) => {
    const firmwareAsset = r.assets.find((a) => a.name === "firmware.bin");
    return {
      tag: r.tag_name,
      name: r.name,
      publishedAt: r.published_at,
      prerelease: r.prerelease,
      // API URL — download via this with Accept: application/octet-stream + auth header
      firmwareAssetApiUrl: firmwareAsset?.url ?? "",
    };
  });
}

/**
 * Download the firmware asset and flash it to the ESP8266 on the given port.
 *
 * Security:
 * - `releaseTag` is validated against TAG_PATTERN before use.
 * - `firmwareAssetApiUrl` must begin with the trusted GitHub API prefix.
 * - `port` comes from the serial port enumeration list (system-trusted).
 * - `Bun.spawn` receives an argument array — no shell interpretation.
 * - `ESPTOOL_PATH` is resolved at module load from a known bundle path.
 */
export async function flashFirmware(
  releaseTag: string,
  port: string,
  firmwareAssetApiUrl: string,
  token: string,
): Promise<void> {
  if (!TAG_PATTERN.test(releaseTag)) {
    throw new Error(`Invalid release tag: "${releaseTag}"`);
  }

  // Validate the asset URL is a known-safe GitHub API origin
  const ALLOWED_PREFIX = "https://api.github.com/repos/LeoLTM/speedcamera/releases/assets/";
  if (!firmwareAssetApiUrl.startsWith(ALLOWED_PREFIX)) {
    throw new Error("Invalid firmware asset URL");
  }

  const tmpPath = join(tmpdir(), `speedcamera-firmware-${releaseTag}.bin`);

  // ── Download via GitHub API asset endpoint (works for private repos) ───────
  push({ type: "downloading" });
  const dlResp = await fetch(firmwareAssetApiUrl, {
    headers: githubHeaders(token, "application/octet-stream"),
    redirect: "follow",
  });
  if (!dlResp.ok) {
    throw new Error(`Failed to download firmware: ${dlResp.status} ${dlResp.statusText}`);
  }
  await Bun.write(tmpPath, dlResp);

  // ── Spawn esptool ──────────────────────────────────────────────────────────
  // ESP8266 D1 Mini flash parameters:
  //   --flash_mode dout   required for D1 Mini (DOUT SPI mode)
  //   --flash_freq 40m    40 MHz clock
  //   --flash_size detect auto-detect flash size
  //   0x0                 write to start of flash
  const proc = Bun.spawn(
    [
      ESPTOOL_PATH,
      "--port", port,
      "--baud", "460800",
      "--chip", "esp8266",
      "write_flash",
      "--flash_mode", "dout",
      "--flash_freq", "40m",
      "--flash_size", "detect",
      "0x0",
      tmpPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  _activeProc = proc;

  const decoder = new TextDecoder();
  let lineBuffer = "";

  function flushLines(chunk: string): void {
    lineBuffer += chunk;
    const parts = lineBuffer.split("\n");
    lineBuffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.replace(/\r$/, "").trim();
      if (trimmed) push({ type: "output", line: trimmed });
    }
  }

  async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        flushLines(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
      flushLines(decoder.decode());
    }
  }

  await Promise.all([drainStream(proc.stdout), drainStream(proc.stderr)]);

  const exitCode = await proc.exited;
  _activeProc = null;

  if (exitCode !== 0) {
    throw new Error(`esptool exited with code ${exitCode}`);
  }

  push({ type: "done" });
}

/**
 * Kill the currently running esptool process (if any).
 */
export function cancelFlash(): void {
  if (_activeProc) {
    _activeProc.kill();
    _activeProc = null;
  }
}

