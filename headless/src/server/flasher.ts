import { join, dirname } from "path";
import { tmpdir } from "os";
import { existsSync } from "fs";
import type { GithubRelease, FlashProgressPayload } from "../shared/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API_URL = "https://api.github.com/repos/LeoLTM/speedcamera/releases";
const GITHUB_USER_URL = "https://api.github.com/user";

// Only allow well-formed version tags from our own repo
const TAG_PATTERN = /^v\d+\.\d+\.\d+(-canary)?$/;

// ─── esptool binary path resolution ──────────────────────────────────────────

function resolveEsptoolPath(): string {
  const binDir = dirname(process.execPath || process.argv[0] || "");
  const candidates = [
    join(process.cwd(), "resources", "esptool"),
    join(import.meta.dir, "..", "..", "resources", "esptool"),
    join(import.meta.dir, "..", "resources", "esptool"),
    join(binDir, "esptool"),
    "/usr/bin/esptool",
    "/usr/local/bin/esptool",
    "/usr/bin/esptool.py",
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

export function initFlasher(push: PushFn): void {
  _push = push;
}

function push(payload: FlashProgressPayload): void {
  _push?.(payload);
}

// ─── Active process handle ────────────────────────────────────────────────────

let _activeProc: ReturnType<typeof Bun.spawn> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

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
      firmwareAssetApiUrl: firmwareAsset?.url ?? "",
    };
  });
}

export async function flashFirmware(
  releaseTag: string,
  port: string,
  firmwareAssetApiUrl: string,
  token: string,
): Promise<void> {
  if (!TAG_PATTERN.test(releaseTag)) {
    throw new Error(`Invalid release tag: "${releaseTag}"`);
  }

  const ALLOWED_PREFIX = "https://api.github.com/repos/LeoLTM/speedcamera/releases/assets/";
  if (!firmwareAssetApiUrl.startsWith(ALLOWED_PREFIX)) {
    throw new Error("Invalid firmware asset URL");
  }

  const tmpPath = join(tmpdir(), `speedcamera-firmware-${releaseTag}.bin`);

  push({ type: "downloading" });
  const dlResp = await fetch(firmwareAssetApiUrl, {
    headers: githubHeaders(token, "application/octet-stream"),
    redirect: "follow",
  });
  if (!dlResp.ok) {
    throw new Error(`Failed to download firmware: ${dlResp.status} ${dlResp.statusText}`);
  }
  await Bun.write(tmpPath, dlResp);

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

export function cancelFlash(): void {
  if (_activeProc) {
    _activeProc.kill();
    _activeProc = null;
  }
}
