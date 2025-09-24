import Database from 'better-sqlite3';
import { SpeedViolation } from '../types/database';
import fs from 'fs';
import path from 'path';

// Create a simplified database service for scripts
class ScriptDatabaseService {
  private db: Database.Database | null;
  private dbPath: string;

  constructor() {
    // Use current directory for script context
    this.dbPath = path.join('.', 'speedcamera.db');
    console.log(`📂 Using database at: ${this.dbPath}`);
    
    if (!fs.existsSync(this.dbPath)) {
      console.log('ℹ️  Database file does not exist');
      this.db = null;
      return;
    }
    
    this.db = new Database(this.dbPath);
  }

  public getViolationCount(): number {
    if (!this.db) return 0;
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM speed_violations');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  public getViolations(): SpeedViolation[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM speed_violations');
    return stmt.all() as SpeedViolation[];
  }

  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  public deleteDatabase(): void {
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
  }
}

async function clearDatabase() {
  console.log('🧹 Starting database cleanup...');
  
  try {
    const dbService = new ScriptDatabaseService();
    
    // Get current violation count
    const currentCount = dbService.getViolationCount();
    console.log(`📊 Current violations in database: ${currentCount}`);
    
    if (currentCount === 0) {
      console.log('✨ Database is already empty!');
      dbService.close();
      return;
    }
    
    // Get all violations to clean up their images
    const violations = dbService.getViolations();
    
    // Delete associated image files
    let deletedImages = 0;
    for (const violation of violations) {
      try {
        if (fs.existsSync(violation.imagePath)) {
          fs.unlinkSync(violation.imagePath);
          deletedImages++;
          console.log(`🗑️  Deleted image: ${violation.imagePath}`);
        }
      } catch (error) {
        console.warn(`⚠️  Could not delete image ${violation.imagePath}:`, error);
      }
    }
    
    // Clear the database by deleting the file
    dbService.close();
    dbService.deleteDatabase();
    console.log('🗑️  Deleted database file');
    
    console.log(`✅ Cleared ${currentCount} violations from database`);
    console.log(`🖼️  Deleted ${deletedImages} associated images`);
    console.log('🎉 Database cleanup completed!');
    
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  clearDatabase()
    .then(() => {
      console.log('✨ Database cleanup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database cleanup failed:', error);
      process.exit(1);
    });
}

export { clearDatabase };
