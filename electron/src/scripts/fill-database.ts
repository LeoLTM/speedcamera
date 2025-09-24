import Database from 'better-sqlite3';
import { CreateSpeedViolation, SpeedViolation } from '../types/database';
import fs from 'fs';
import path from 'path';

// Create a simplified database service for scripts
class ScriptDatabaseService {
  private db: Database.Database;

  constructor() {
    // Use current directory for script context
    const dbPath = path.join('.', 'speedcamera.db');
    console.log(`📂 Using database at: ${dbPath}`);
    
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

  public getViolationCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM speed_violations');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  public close(): void {
    this.db.close();
  }
}

// Sample data for violations
const sampleViolations: Omit<CreateSpeedViolation, 'imagePath'>[] = [
  { measuredSpeed: 65.2, maxSpeed: 50 },
  { measuredSpeed: 78.5, maxSpeed: 60 },
  { measuredSpeed: 92.1, maxSpeed: 80 },
  { measuredSpeed: 55.7, maxSpeed: 40 },
  { measuredSpeed: 71.3, maxSpeed: 50 },
  { measuredSpeed: 45.8, maxSpeed: 30 },
  { measuredSpeed: 88.9, maxSpeed: 70 },
  { measuredSpeed: 67.4, maxSpeed: 50 },
  { measuredSpeed: 101.2, maxSpeed: 90 },
  { measuredSpeed: 52.6, maxSpeed: 40 },
];

async function createSampleImage(fileName: string): Promise<string> {
  // Create a simple placeholder image (1x1 PNG) as base64
  const placeholderImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const imageBuffer = Buffer.from(placeholderImageBase64, 'base64');
  
  const savedImagesDir = 'savedImages';
  
  // Ensure savedImages directory exists
  if (!fs.existsSync(savedImagesDir)) {
    fs.mkdirSync(savedImagesDir, { recursive: true });
  }
  
  const imagePath = path.join(savedImagesDir, fileName);
  fs.writeFileSync(imagePath, imageBuffer);
  
  return imagePath;
}

async function fillDatabase() {
  console.log('🚀 Starting database population...');
  
  try {
    const dbService = new ScriptDatabaseService();
    
    // Check if database already has data
    const existingCount = dbService.getViolationCount();
    if (existingCount > 0) {
      console.log(`⚠️  Database already contains ${existingCount} violations.`);
      console.log('Proceeding to add sample data anyway...');
    }
    
    let addedCount = 0;
    
    for (let i = 0; i < sampleViolations.length; i++) {
      const violation = sampleViolations[i];
      
      // Create a sample image for this violation
      const timestamp = new Date(Date.now() - (i * 24 * 60 * 60 * 1000)); // Spread violations over past days
      const imageFileName = `sample-violation-${timestamp.toISOString().replace(/[:.]/g, '-')}.png`;
      const imagePath = await createSampleImage(imageFileName);
      
      // Add violation to database
      const savedViolation = dbService.addViolation({
        measuredSpeed: violation.measuredSpeed,
        maxSpeed: violation.maxSpeed,
        imagePath: imagePath,
      });
      
      console.log(`✅ Added violation #${savedViolation.id}: ${violation.measuredSpeed} km/h in ${violation.maxSpeed} km/h zone`);
      addedCount++;
      
      // Add some delay to make timestamps more realistic
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`🎉 Successfully added ${addedCount} sample violations to the database!`);
    console.log(`📊 Total violations in database: ${dbService.getViolationCount()}`);
    
    // Close database connection
    dbService.close();
    
  } catch (error) {
    console.error('❌ Error filling database:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  fillDatabase()
    .then(() => {
      console.log('✨ Database population completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database population failed:', error);
      process.exit(1);
    });
}

export { fillDatabase };
