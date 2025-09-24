import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import React from 'react';

interface SampleViolation {
  measuredSpeed: number;
  maxSpeed: number;
  imagePath: string;
  timestamp: string;
}

export default function DatabaseControls() {
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>('');

  const importSampleData = async () => {
    setIsImporting(true);
    setImportStatus('Loading sample data...');

    try {
      // Fetch the sample data
      const response = await fetch('./data/sample-violations.json');
      if (!response.ok) {
        throw new Error('Sample data file not found. Please run "npm run db:generate" first.');
      }

      const sampleData: SampleViolation[] = await response.json();
      setImportStatus(`Importing ${sampleData.length} violations...`);

      // Import each violation
      let imported = 0;
      for (const violation of sampleData) {
        try {
          await window.database.addViolation({
            measuredSpeed: violation.measuredSpeed,
            maxSpeed: violation.maxSpeed,
            imagePath: violation.imagePath,
          });
          imported++;
          setImportStatus(`Imported ${imported}/${sampleData.length} violations...`);
        } catch (error) {
          console.warn('Failed to import violation:', violation, error);
        }
      }

      setImportStatus(`✅ Successfully imported ${imported} sample violations!`);
      
      // Refresh the page to show new data
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error: any) {
      console.error('Error importing sample data:', error);
      setImportStatus(`❌ Error: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const clearDatabase = async () => {
    if (!confirm('Are you sure you want to delete ALL violations? This cannot be undone.')) {
      return;
    }

    setImportStatus('Clearing database...');

    try {
      const violations = await window.database.getViolations();
      let deleted = 0;

      for (const violation of violations) {
        const success = await window.database.deleteViolation(violation.id);
        if (success) deleted++;
      }

      setImportStatus(`✅ Cleared ${deleted} violations`);
      
      // Refresh the page
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (error: any) {
      console.error('Error clearing database:', error);
      setImportStatus(`❌ Error clearing database: ${error.message}`);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Database Controls</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={importSampleData}
            disabled={isImporting}
            variant="outline"
          >
            {isImporting ? 'Importing...' : 'Import Sample Data'}
          </Button>
          
          <Button
            onClick={clearDatabase}
            disabled={isImporting}
            variant="destructive"
          >
            Clear All Violations
          </Button>
        </div>
        
        {importStatus && (
          <div className="mt-3 p-2 bg-muted rounded text-sm">
            {importStatus}
          </div>
        )}
        
        <div className="mt-3 text-xs text-muted-foreground">
          <p>
            <strong>Import Sample Data:</strong> Adds sample violations with placeholder images.
            Run <code>npm run db:generate</code> first to create the sample data file.
          </p>
          <p className="mt-1">
            <strong>Clear All:</strong> Removes all violations from the database.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
