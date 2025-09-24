import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import { SpeedViolation, CreateSpeedViolation } from '../types/database';

class DatabaseService {
  private db: Database.Database;

  constructor() {
    // Store database in user data directory
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'speedcamera.db');
    
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    // Create speed_violations table
    const createTable = `
      CREATE TABLE IF NOT EXISTS speed_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        measuredSpeed REAL NOT NULL,
        maxSpeed REAL NOT NULL,
        imagePath TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    this.db.exec(createTable);
    
    // Create index on timestamp for faster queries
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_timestamp ON speed_violations(timestamp)');
  }

  public addViolation(violation: CreateSpeedViolation): SpeedViolation {
    const timestamp = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO speed_violations (timestamp, measuredSpeed, maxSpeed, imagePath, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      timestamp,
      violation.measuredSpeed,
      violation.maxSpeed,
      violation.imagePath,
      timestamp
    );
    
    return {
      id: result.lastInsertRowid as number,
      timestamp,
      measuredSpeed: violation.measuredSpeed,
      maxSpeed: violation.maxSpeed,
      imagePath: violation.imagePath,
      createdAt: timestamp,
    };
  }

  public getViolations(limit?: number, offset?: number): SpeedViolation[] {
    let query = 'SELECT * FROM speed_violations ORDER BY timestamp DESC';
    const params: any[] = [];
    
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params) as SpeedViolation[];
  }

  public getViolationById(id: number): SpeedViolation | undefined {
    const stmt = this.db.prepare('SELECT * FROM speed_violations WHERE id = ?');
    return stmt.get(id) as SpeedViolation | undefined;
  }

  public getViolationsByDateRange(startDate: string, endDate: string): SpeedViolation[] {
    const stmt = this.db.prepare(`
      SELECT * FROM speed_violations 
      WHERE timestamp BETWEEN ? AND ? 
      ORDER BY timestamp DESC
    `);
    return stmt.all(startDate, endDate) as SpeedViolation[];
  }

  public deleteViolation(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM speed_violations WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public getViolationCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM speed_violations');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  public close(): void {
    this.db.close();
  }
}

// Singleton instance
let dbService: DatabaseService | null = null;

export const getDatabaseService = (): DatabaseService => {
  if (!dbService) {
    dbService = new DatabaseService();
  }
  return dbService;
};

export const closeDatabaseService = (): void => {
  if (dbService) {
    dbService.close();
    dbService = null;
  }
};

export { DatabaseService };
