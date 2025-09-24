import fs from 'fs';
import path from 'path';

// Sample violation data
const sampleViolations = [
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

async function createSampleImages() {
  console.log('🖼️  Creating sample images...');
  
  // Create a simple placeholder image (1x1 PNG) as base64
  const placeholderImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const imageBuffer = Buffer.from(placeholderImageBase64, 'base64');
  
  const savedImagesDir = 'savedImages';
  
  // Ensure savedImages directory exists
  if (!fs.existsSync(savedImagesDir)) {
    fs.mkdirSync(savedImagesDir, { recursive: true });
  }
  
  const imagePaths: string[] = [];
  
  for (let i = 0; i < sampleViolations.length; i++) {
    const timestamp = new Date(Date.now() - (i * 24 * 60 * 60 * 1000)); // Spread violations over past days
    const imageFileName = `sample-violation-${timestamp.toISOString().replace(/[:.]/g, '-')}.png`;
    const imagePath = path.join(savedImagesDir, imageFileName);
    
    fs.writeFileSync(imagePath, imageBuffer);
    imagePaths.push(imagePath);
    console.log(`📸 Created: ${imagePath}`);
  }
  
  return imagePaths;
}

async function generateSampleData() {
  console.log('🚀 Generating sample violation data...');
  
  try {
    // Create sample images
    const imagePaths = await createSampleImages();
    
    // Generate violation data with image paths and timestamps
    const violationsWithData = sampleViolations.map((violation, index) => {
      const timestamp = new Date(Date.now() - (index * 24 * 60 * 60 * 1000));
      return {
        ...violation,
        imagePath: imagePaths[index],
        timestamp: timestamp.toISOString(),
      };
    });
    
    // Save to JSON file that can be imported by the app
    const dataDir = 'data';
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const dataFile = path.join(dataDir, 'sample-violations.json');
    fs.writeFileSync(dataFile, JSON.stringify(violationsWithData, null, 2));
    
    console.log(`📁 Saved sample data to: ${dataFile}`);
    console.log(`🎉 Generated ${violationsWithData.length} sample violations!`);
    console.log('');
    console.log('💡 To import this data into your app:');
    console.log('   1. Start your Electron app');
    console.log('   2. Go to the Violations page');
    console.log('   3. Use the developer tools console to run:');
    console.log('      fetch("./data/sample-violations.json").then(r=>r.json()).then(data=>data.forEach(v=>window.database.addViolation(v)))');
    
  } catch (error) {
    console.error('❌ Error generating sample data:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  generateSampleData()
    .then(() => {
      console.log('✨ Sample data generation completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Sample data generation failed:', error);
      process.exit(1);
    });
}

export { generateSampleData };
