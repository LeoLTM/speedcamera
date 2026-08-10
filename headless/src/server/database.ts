import { Database } from "bun:sqlite";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import type {
  Violation,
  SaveViolationInput,
  AppSettings,
  ViolationQuery,
  ViolationPage,
  Lap,
  LapSession,
  LapSessionWithLaps,
  SaveLapInput,
} from "../shared/types";

// ─── Default settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  maxSpeed: 30,
  selectedPort: "",
  // Industrial Camera Settings
  cameraExposure: 5000,
  cameraGain: 0,
  strobeLineDuration: 5000,
  pixelFormat: "Mono",
  exposureAuto: "Off",
  gainAuto: "Off",
  frameRate: 30,
  cameraWidth: 1280,
  cameraHeight: 1024,
  blackLevel: 0,
  // Lap timer settings
  lapMode: "single",
  lapSaveImages: "true",
  lapDirFilter: "both",
  // Teable integration
  teableUrl: "",
  teableToken: "",
  teableUserName: "",
  teableUserEmail: "",
  teableUserAvatar: "",
  teableSpaceId: "",
  teableBaseId: "",
  teableTableId: "",
  teableSyncEnabled: "false",
  githubToken: "",
  // Poliscan skin
  skinMeasuringLocation: "",
};

// ─── Database directory resolution ──────────────────────────────────────────

export function getUserDataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.env.HOME || process.cwd(), ".speedcamera");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const userDataDir = getUserDataDir();
  const dbPath = path.join(userDataDir, "speedcamera.db");
  const db = new Database(dbPath, { create: true });

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS speed_violations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL,
      measuredSpeed REAL  NOT NULL,
      maxSpeed    REAL    NOT NULL,
      direction   TEXT    NOT NULL DEFAULT 'forward',
      imagePath   TEXT    NOT NULL,
      createdAt   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.run("ALTER TABLE speed_violations ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'");
  } catch {
    // Column already exists
  }

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_timestamp ON speed_violations(timestamp)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lap_sessions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      startedAt TEXT    NOT NULL,
      endedAt   TEXT,
      lapMode   TEXT    NOT NULL,
      createdAt TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS laps (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId        INTEGER NOT NULL REFERENCES lap_sessions(id) ON DELETE CASCADE,
      lapNumber        INTEGER NOT NULL,
      startTimestamp   INTEGER NOT NULL,
      endTimestamp     INTEGER NOT NULL,
      durationMs       INTEGER NOT NULL,
      speedAtStart     REAL    NOT NULL,
      speedAtEnd       REAL    NOT NULL,
      startImagePath   TEXT,
      endImagePath     TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(sessionId)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_lap_sessions_started ON lap_sessions(startedAt)
  `);

  const insertDefault = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertDefault.run(key, String(value));
  }

  _db = db;
  return db;
}

// ─── Violation queries ───────────────────────────────────────────────────────

export function insertViolation(input: SaveViolationInput & { imagePath: string }): Violation {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO speed_violations (timestamp, measuredSpeed, maxSpeed, direction, imagePath, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(now, input.measuredSpeed, input.maxSpeed, input.direction, input.imagePath, now);
  return {
    id: result.lastInsertRowid as number,
    timestamp: now,
    measuredSpeed: input.measuredSpeed,
    maxSpeed: input.maxSpeed,
    direction: input.direction,
    imagePath: input.imagePath,
    createdAt: now,
  };
}

export function queryViolations(q: ViolationQuery): ViolationPage {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (q.dateFrom) {
    conditions.push("timestamp >= ?");
    params.push(q.dateFrom);
  }
  if (q.dateTo) {
    conditions.push("timestamp <= ?");
    params.push(q.dateTo);
  }
  if (q.minSpeed != null) {
    conditions.push("measuredSpeed >= ?");
    params.push(q.minSpeed);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM speed_violations ${where}`)
    .get(...params) as { total: number };

  const offset = (q.page - 1) * q.limit;
  const violations = db
    .prepare(
      `SELECT * FROM speed_violations ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    )
    .all(...params, q.limit, offset) as Violation[];

  return { violations, total: countRow.total };
}

export function getViolationById(id: number): Violation | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM speed_violations WHERE id = ?").get(id) as Violation | undefined) ??
    null
  );
}

export function removeViolation(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM speed_violations WHERE id = ?").run(id);
}

export function exportCsv(opts: {
  dateFrom?: string;
  dateTo?: string;
  minSpeed?: number;
}): string {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.dateFrom) {
    conditions.push("timestamp >= ?");
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    conditions.push("timestamp <= ?");
    params.push(opts.dateTo);
  }
  if (opts.minSpeed != null) {
    conditions.push("measuredSpeed >= ?");
    params.push(opts.minSpeed);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM speed_violations ${where} ORDER BY timestamp DESC`)
    .all(...params) as Violation[];

  const header = "id,timestamp,measuredSpeed,maxSpeed,direction,imagePath,createdAt";
  const lines = rows.map(
    (r) =>
      `${r.id},"${r.timestamp}",${r.measuredSpeed},${r.maxSpeed},${r.direction},"${r.imagePath}","${r.createdAt}"`
  );
  return [header, ...lines].join("\n");
}

// ─── Settings queries ────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];

  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    maxSpeed: Number(map.maxSpeed ?? DEFAULT_SETTINGS.maxSpeed),
    selectedPort: map.selectedPort ?? DEFAULT_SETTINGS.selectedPort,
    cameraExposure: Number(map.cameraExposure ?? DEFAULT_SETTINGS.cameraExposure),
    cameraGain: Number(map.cameraGain ?? DEFAULT_SETTINGS.cameraGain),
    strobeLineDuration: Number(map.strobeLineDuration ?? DEFAULT_SETTINGS.strobeLineDuration),
    pixelFormat: map.pixelFormat ?? DEFAULT_SETTINGS.pixelFormat,
    exposureAuto: map.exposureAuto ?? DEFAULT_SETTINGS.exposureAuto,
    gainAuto: map.gainAuto ?? DEFAULT_SETTINGS.gainAuto,
    frameRate: Number(map.frameRate ?? DEFAULT_SETTINGS.frameRate),
    cameraWidth: Number(map.cameraWidth ?? DEFAULT_SETTINGS.cameraWidth),
    cameraHeight: Number(map.cameraHeight ?? DEFAULT_SETTINGS.cameraHeight),
    blackLevel: Number(map.blackLevel ?? DEFAULT_SETTINGS.blackLevel),
    lapMode: map.lapMode ?? DEFAULT_SETTINGS.lapMode,
    lapSaveImages: map.lapSaveImages ?? DEFAULT_SETTINGS.lapSaveImages,
    lapDirFilter: map.lapDirFilter ?? DEFAULT_SETTINGS.lapDirFilter,
    teableUrl: map.teableUrl ?? DEFAULT_SETTINGS.teableUrl,
    teableToken: map.teableToken ?? DEFAULT_SETTINGS.teableToken,
    teableUserName: map.teableUserName ?? DEFAULT_SETTINGS.teableUserName,
    teableUserEmail: map.teableUserEmail ?? DEFAULT_SETTINGS.teableUserEmail,
    teableUserAvatar: map.teableUserAvatar ?? DEFAULT_SETTINGS.teableUserAvatar,
    teableSpaceId: map.teableSpaceId ?? DEFAULT_SETTINGS.teableSpaceId,
    teableBaseId: map.teableBaseId ?? DEFAULT_SETTINGS.teableBaseId,
    teableTableId: map.teableTableId ?? DEFAULT_SETTINGS.teableTableId,
    teableSyncEnabled: map.teableSyncEnabled ?? DEFAULT_SETTINGS.teableSyncEnabled,
    githubToken: map.githubToken ?? DEFAULT_SETTINGS.githubToken,
    skinMeasuringLocation: map.skinMeasuringLocation ?? DEFAULT_SETTINGS.skinMeasuringLocation,
  };
}

export function saveSetting(key: keyof AppSettings, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    value
  );
}

// ─── Lap session queries ───────────────────────────────────────────────────────

export function createLapSession(lapMode: string): LapSession {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO lap_sessions (startedAt, endedAt, lapMode, createdAt) VALUES (?, NULL, ?, ?)"
    )
    .run(now, lapMode, now);
  return {
    id: result.lastInsertRowid as number,
    startedAt: now,
    endedAt: null,
    lapMode,
    createdAt: now,
  };
}

export function closeLapSession(id: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE lap_sessions SET endedAt = ? WHERE id = ?").run(now, id);
}

export function getLapSessions(
  page: number,
  limit: number
): { sessions: LapSessionWithLaps[]; total: number } {
  const db = getDb();
  const countRow = db
    .prepare("SELECT COUNT(*) as total FROM lap_sessions")
    .get() as { total: number };

  const offset = (page - 1) * limit;
  const rows = db
    .prepare(
      "SELECT * FROM lap_sessions ORDER BY startedAt DESC LIMIT ? OFFSET ?"
    )
    .all(limit, offset) as LapSession[];

  const sessions: LapSessionWithLaps[] = rows.map((session) => {
    const laps = db
      .prepare(
        "SELECT * FROM laps WHERE sessionId = ? ORDER BY lapNumber ASC"
      )
      .all(session.id) as Lap[];
    return { ...session, laps };
  });

  return { sessions, total: countRow.total };
}

export function getLapSessionById(id: number): LapSessionWithLaps | null {
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM lap_sessions WHERE id = ?")
    .get(id) as LapSession | undefined;
  if (!session) return null;

  const laps = db
    .prepare("SELECT * FROM laps WHERE sessionId = ? ORDER BY lapNumber ASC")
    .all(id) as Lap[];

  return { ...session, laps };
}

export async function deleteLapSession(id: number): Promise<void> {
  const db = getDb();
  const laps = db
    .prepare("SELECT startImagePath, endImagePath FROM laps WHERE sessionId = ?")
    .all(id) as Pick<Lap, "startImagePath" | "endImagePath">[];

  db.prepare("DELETE FROM lap_sessions WHERE id = ?").run(id);

  const { deleteImage } = await import("./filestore");
  for (const lap of laps) {
    if (lap.startImagePath) await deleteImage(lap.startImagePath);
    if (lap.endImagePath) await deleteImage(lap.endImagePath);
  }
}

// ─── Lap queries ──────────────────────────────────────────────────────────────

export async function insertLap(
  input: SaveLapInput & { startImagePath: string | null; endImagePath: string | null }
): Promise<Lap> {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO laps
        (sessionId, lapNumber, startTimestamp, endTimestamp, durationMs,
         speedAtStart, speedAtEnd, startImagePath, endImagePath)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      input.lapNumber,
      input.startTimestamp,
      input.endTimestamp,
      input.durationMs,
      input.speedAtStart,
      input.speedAtEnd,
      input.startImagePath,
      input.endImagePath
    );
  return {
    id: result.lastInsertRowid as number,
    sessionId: input.sessionId,
    lapNumber: input.lapNumber,
    startTimestamp: input.startTimestamp,
    endTimestamp: input.endTimestamp,
    durationMs: input.durationMs,
    speedAtStart: input.speedAtStart,
    speedAtEnd: input.speedAtEnd,
    startImagePath: input.startImagePath,
    endImagePath: input.endImagePath,
  };
}

export async function deleteLap(id: number): Promise<void> {
  const db = getDb();
  const lap = db.prepare("SELECT startImagePath, endImagePath FROM laps WHERE id = ?").get(
    id
  ) as Pick<Lap, "startImagePath" | "endImagePath"> | undefined;

  db.prepare("DELETE FROM laps WHERE id = ?").run(id);

  if (lap) {
    const { deleteImage } = await import("./filestore");
    if (lap.startImagePath) await deleteImage(lap.startImagePath);
    if (lap.endImagePath) await deleteImage(lap.endImagePath);
  }
}
