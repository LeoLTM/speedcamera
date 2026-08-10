import { getSettings, saveSetting } from "./database";
import type { Lap, LapSession, TeableUser, TeableSpace, TeableBase, TeableTable, TeableSchemaCheck } from "../shared/types";

// ─── Required fields for the Laps table ──────────────────────────────────────

interface RequiredField {
  name: string;
  type: string;
}

const REQUIRED_FIELDS: RequiredField[] = [
  { name: "Session Started At", type: "singleLineText" },
  { name: "Lap Mode",           type: "singleLineText" },
  { name: "Lap Number",         type: "number" },
  { name: "Start Time",         type: "singleLineText" },
  { name: "End Time",           type: "singleLineText" },
  { name: "Duration",           type: "singleLineText" },
  { name: "Speed At Start",     type: "number" },
  { name: "Speed At End",       type: "number" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FETCH_OPTS = { tls: { rejectUnauthorized: false } } as RequestInit;

function buildHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...FETCH_OPTS, ...init, headers: { ...init?.headers } });
}

function formatDuration(ms: number): string {
  const total = Math.round(ms);
  const totalSeconds = Math.floor(total / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function getConfig(): { url: string; token: string } {
  const settings = getSettings();
  const url = settings.teableUrl.replace(/\/+$/, "");
  const token = settings.teableToken;
  if (!url) throw new Error("Teable not configured");
  if (!token) throw new Error("Teable token not found");
  return { url, token };
}

// ─── Connection test ──────────────────────────────────────────────────────────

export async function testTeableConnection(url: string, token: string): Promise<TeableUser> {
  const base = url.replace(/\/+$/, "");

  let spacesResp: Response;
  try {
    spacesResp = await apiFetch(`${base}/api/space`, { headers: buildHeaders(token) });
  } catch (e) {
    throw new Error(`Could not connect to ${base} — check the URL and your network connection. Details: ${String(e)}`);
  }

  if (spacesResp.status === 401) {
    throw new Error("Invalid or expired access token. Please check your Personal Access Token.");
  }
  if (!spacesResp.ok) {
    const body = await spacesResp.text().catch(() => "");
    throw new Error(`Teable API returned ${spacesResp.status} — ${body}`);
  }

  let user: TeableUser = { id: "", name: "Teable User", email: "", avatar: null };
  try {
    const userResp = await apiFetch(`${base}/api/auth/user/me`, { headers: buildHeaders(token) });
    if (userResp.ok) {
      const data = await userResp.json() as { id?: string; name?: string; email?: string; avatar?: string };
      user = {
        id: data.id ?? "",
        name: data.name ?? "Teable User",
        email: data.email ?? "",
        avatar: data.avatar ?? null,
      };
    }
  } catch {
    // Fallback
  }

  return user;
}

// ─── Config management ────────────────────────────────────────────────────────

export function saveTeableConfig(
  url: string,
  token: string,
  userName: string,
  userEmail: string,
  userAvatar: string | null,
): void {
  saveSetting("teableUrl", url);
  saveSetting("teableToken", token);
  saveSetting("teableUserName", userName);
  saveSetting("teableUserEmail", userEmail);
  saveSetting("teableUserAvatar", userAvatar ?? "");
}

export function removeTeableConfig(): void {
  saveSetting("teableUrl", "");
  saveSetting("teableToken", "");
  saveSetting("teableUserName", "");
  saveSetting("teableUserEmail", "");
  saveSetting("teableUserAvatar", "");
  saveSetting("teableSpaceId", "");
  saveSetting("teableBaseId", "");
  saveSetting("teableTableId", "");
  saveSetting("teableSyncEnabled", "false");
}

export function saveTeableTarget(spaceId: string, baseId: string, tableId: string): void {
  saveSetting("teableSpaceId", spaceId);
  saveSetting("teableBaseId", baseId);
  saveSetting("teableTableId", tableId);
}

// ─── Spaces / Bases / Tables ──────────────────────────────────────────────────

export async function listTeableSpaces(): Promise<TeableSpace[]> {
  const { url, token } = getConfig();
  const resp = await apiFetch(`${url}/api/space`, { headers: buildHeaders(token) });
  if (!resp.ok) throw new Error(`Failed to fetch spaces: ${resp.status}`);
  return resp.json() as Promise<TeableSpace[]>;
}

export async function listTeableBases(spaceId: string): Promise<TeableBase[]> {
  const { url, token } = getConfig();
  const resp = await apiFetch(`${url}/api/space/${encodeURIComponent(spaceId)}/base`, {
    headers: buildHeaders(token),
  });
  if (!resp.ok) throw new Error(`Failed to fetch bases: ${resp.status}`);
  return resp.json() as Promise<TeableBase[]>;
}

export async function listTeableTables(baseId: string): Promise<TeableTable[]> {
  const { url, token } = getConfig();
  const resp = await apiFetch(`${url}/api/base/${encodeURIComponent(baseId)}/table`, {
    headers: buildHeaders(token),
  });
  if (!resp.ok) throw new Error(`Failed to fetch tables: ${resp.status}`);
  return resp.json() as Promise<TeableTable[]>;
}

// ─── Schema verification & provisioning ──────────────────────────────────────

async function listFields(url: string, token: string, tableId: string): Promise<Array<{ name: string }>> {
  const resp = await apiFetch(`${url}/api/table/${encodeURIComponent(tableId)}/field`, {
    headers: buildHeaders(token),
  });
  if (!resp.ok) throw new Error(`Failed to fetch fields: ${resp.status}`);
  return resp.json() as Promise<Array<{ name: string }>>;
}

export async function verifyTeableTable(tableId: string): Promise<TeableSchemaCheck> {
  const { url, token } = getConfig();
  const fields = await listFields(url, token, tableId);
  const existing = new Set(fields.map((f) => f.name));
  const missingFields = REQUIRED_FIELDS.filter((f) => !existing.has(f.name)).map((f) => f.name);
  return { missingFields };
}

export async function ensureTeableFields(tableId: string): Promise<string[]> {
  const { url, token } = getConfig();
  const fields = await listFields(url, token, tableId);
  const existing = new Set(fields.map((f) => f.name));

  const created: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (existing.has(field.name)) continue;

    const resp = await apiFetch(`${url}/api/table/${encodeURIComponent(tableId)}/field`, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify({ type: field.type, name: field.name }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Failed to create field '${field.name}': ${resp.status} — ${body}`);
    }
    created.push(field.name);
  }

  return created;
}

export async function createTeableTable(baseId: string, tableName: string): Promise<TeableTable> {
  const { url, token } = getConfig();

  const resp = await apiFetch(`${url}/api/base/${encodeURIComponent(baseId)}/table`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({
      name: tableName,
      fields: REQUIRED_FIELDS.map((f) => ({ type: f.type, name: f.name })),
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Failed to create table: ${resp.status} — ${body}`);
  }

  const data = await resp.json() as { id: string; name: string };
  return { id: data.id, name: data.name };
}

// ─── Lap sync ─────────────────────────────────────────────────────────────────

export async function syncLapToTeable(lap: Lap, session: LapSession): Promise<void> {
  const { url, token } = getConfig();
  const settings = getSettings();
  const tableId = settings.teableTableId;
  if (!tableId) throw new Error("No Teable table selected");

  const fields: Record<string, string | number> = {
    "Session Started At": session.startedAt,
    "Lap Mode": session.lapMode,
    "Lap Number": lap.lapNumber,
    "Start Time": new Date(lap.startTimestamp).toISOString(),
    "End Time": new Date(lap.endTimestamp).toISOString(),
    "Duration": formatDuration(lap.durationMs),
    "Speed At Start": lap.speedAtStart,
    "Speed At End": lap.speedAtEnd,
  };

  const resp = await apiFetch(`${url}/api/table/${encodeURIComponent(tableId)}/record`, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({
      fieldKeyType: "name",
      typecast: true,
      records: [{ fields }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Failed to create Teable record: ${resp.status} — ${body}`);
  }
}
