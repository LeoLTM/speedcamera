# Database Management

This application uses SQLite with better-sqlite3 to store speed violation records. Each violation includes:

- **Timestamp**: When the violation occurred
- **Measured Speed**: The speed detected by the radar
- **Max Speed**: The speed limit that was exceeded  
- **Image Path**: Path to the captured photo evidence

## Adding Sample Data

### Method 1: Using the App Interface (Recommended)

1. **Generate sample data first:**
   ```bash
   npm run db:generate
   ```

2. **Start the application:**
   ```bash
   npm start
   ```

3. **Navigate to the Violations page** and click the **"Import Sample Data"** button.

### Method 2: Using Developer Console

1. Generate sample data (step 1 above)
2. Start the app and open Developer Tools (F12)
3. Navigate to the Violations page
4. Run this in the console:
   ```javascript
   fetch("./data/sample-violations.json")
     .then(r=>r.json())
     .then(data=>data.forEach(v=>window.database.addViolation(v)))
   ```

## Database Operations

### Available Scripts

- `npm run db:generate` - Creates sample violation data with placeholder images
- `npm run db:fill` - Shows instructions for importing data via the app
- `npm run db:clear` - Shows instructions for clearing data via the app

### Programmatic Access

The database is accessible through `window.database` in the renderer process:

```javascript
// Add a violation
const violation = await window.database.addViolation({
  measuredSpeed: 65.5,
  maxSpeed: 50,
  imagePath: 'savedImages/photo.png'
});

// Get all violations
const violations = await window.database.getViolations();

// Get violations with pagination
const recentViolations = await window.database.getViolations(10, 0);

// Delete a violation
await window.database.deleteViolation(violationId);

// Get violation count
const count = await window.database.getViolationCount();
```

## Database Location

- **Development**: `speedcamera.db` in the project root
- **Production**: `speedcamera.db` in the app's userData directory

## Image Storage

Violation photos are stored in the `savedImages/` directory with timestamped filenames:
- Format: `speed-violation-YYYY-MM-DDTHH-mm-ss-sssZ.png`
- Sample images: `sample-violation-YYYY-MM-DDTHH-mm-ss-sssZ.png`

## Troubleshooting

**Node.js Version Issues**: The database scripts run within the Electron app context to avoid Node.js version conflicts with native modules. Use the app interface for database operations rather than external scripts.

**Missing Sample Data**: If you see "Sample data file not found", run `npm run db:generate` first to create the sample data file.
