import { Database } from "bun:sqlite";
import { Utils } from "electrobun/bun";
import path from "path";
import type {
  Violation,
  SaveViolationInput,
  AppSettings,
  ViolationQuery,
  ViolationPage,
} from "../shared/types";

// ─── Default settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  flashDelay: 100,
  flashDuration: 50,
  pictureDelay: 100,
  maxSpeed: 30,
  selectedPort: "",
  selectedCamera: "",
};

// ─── Database setup (lazy) ───────────────────────────────────────────────────
// Utils.paths is only valid after the Electrobun native wrapper has initialised,
// so we defer all path resolution and DB creation to the first call.

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;

  const dbPath = path.join(Utils.paths.userData, "speedcamera.db");
  const db = new Database(dbPath, { create: true });

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS speed_violations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL,
      measuredSpeed REAL  NOT NULL,
      maxSpeed    REAL    NOT NULL,
      imagePath   TEXT    NOT NULL,
      createdAt   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_timestamp ON speed_violations(timestamp)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
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
    INSERT INTO speed_violations (timestamp, measuredSpeed, maxSpeed, imagePath, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(now, input.measuredSpeed, input.maxSpeed, input.imagePath, now);
  return {
    id: result.lastInsertRowid as number,
    timestamp: now,
    measuredSpeed: input.measuredSpeed,
    maxSpeed: input.maxSpeed,
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

  const header = "id,timestamp,measuredSpeed,maxSpeed,imagePath,createdAt";
  const lines = rows.map(
    (r) =>
      `${r.id},"${r.timestamp}",${r.measuredSpeed},${r.maxSpeed},"${r.imagePath}","${r.createdAt}"`
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
    flashDelay: Number(map.flashDelay ?? DEFAULT_SETTINGS.flashDelay),
    flashDuration: Number(map.flashDuration ?? DEFAULT_SETTINGS.flashDuration),
    pictureDelay: Number(map.pictureDelay ?? DEFAULT_SETTINGS.pictureDelay),
    maxSpeed: Number(map.maxSpeed ?? DEFAULT_SETTINGS.maxSpeed),
    selectedPort: map.selectedPort ?? DEFAULT_SETTINGS.selectedPort,
    selectedCamera: map.selectedCamera ?? DEFAULT_SETTINGS.selectedCamera,
  };
}

export function saveSetting(key: keyof AppSettings, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    value
  );
}
