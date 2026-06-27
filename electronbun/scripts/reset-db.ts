import { homedir } from "os";
import path from "path";
import { rm, mkdir } from "fs/promises";
import { Database } from "bun:sqlite";

const home = homedir();
const identifier = "com.speedcamera.app";

// Cross-platform app data directory path
function getAppDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support");
    case "win32":
      return process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    default: // linux / others
      return process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  }
}

const DEFAULT_SETTINGS = {
  maxSpeed: 30,
  selectedPort: "",
  cameraExposure: 5000,
  cameraGain: 0,
  strobeLineDuration: 5000,
  lapMode: "single",
  lapSaveImages: "true",
  lapDirFilter: "both",
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
};

const channel = process.argv[2] || process.env.CHANNEL || "dev";

if (channel !== "dev" && channel !== "stable" && channel !== "canary" && channel !== "all") {
  console.error(`Error: Invalid channel "${channel}". Must be "dev", "stable", "canary", or "all".`);
  process.exit(1);
}

const channels = channel === "all" ? ["dev", "stable", "canary"] : [channel];

for (const ch of channels) {
  const userDataDir = path.join(getAppDataDir(), identifier, ch);
  const dbPath = path.join(userDataDir, "speedcamera.db");
  const dbWalPath = path.join(userDataDir, "speedcamera.db-wal");
  const dbShmPath = path.join(userDataDir, "speedcamera.db-shm");
  const imagesDir = path.join(userDataDir, "images");

  console.log(`Resetting database and images for channel "${ch}"...`);
  console.log(`Target directory: ${userDataDir}`);

  // Create userData directory if it doesn't exist (needed to create DB file)
  try {
    await mkdir(userDataDir, { recursive: true });
  } catch (err) {
    console.error(`  Error creating directory ${userDataDir}:`, err);
  }

  // Delete existing database files
  for (const file of [dbPath, dbWalPath, dbShmPath]) {
    try {
      await rm(file, { force: true });
      console.log(`  Deleted ${file}`);
    } catch (err) {
      console.error(`  Error deleting ${file}:`, err);
    }
  }

  // Reset images directory
  try {
    await rm(imagesDir, { recursive: true, force: true });
    await mkdir(imagesDir, { recursive: true });
    await Bun.write(path.join(imagesDir, ".keep"), "");
    console.log(`  Cleared and re-initialized images directory`);
  } catch (err) {
    console.error(`  Error resetting images directory:`, err);
  }

  // Re-initialize database schema
  try {
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

    db.close();
    console.log(`  Database schema and default settings re-initialized successfully!`);
  } catch (err) {
    console.error(`  Failed to re-initialize SQLite database:`, err);
  }
}

console.log("Database reset operation completed.");
