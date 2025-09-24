import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SpeedViolation {
  id: number;
  timestamp: string;
  measuredSpeed: number;
  maxSpeed: number;
  imagePath: string;
  createdAt: string;
}

export default function LastViolationDisplay() {
  const [lastViolation, setLastViolation] = useState<SpeedViolation | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadLastViolation = async () => {
    try {
      setLoading(true);
      const violations = await window.database.getViolations(1); // Get only the most recent violation
      
      if (violations.length > 0) {
        const violation = violations[0];
        setLastViolation(violation);
        
        // Load the image data
        const imageDataUrl = await window.camera.getImageData(violation.imagePath);
        setImageData(imageDataUrl);
      } else {
        setLastViolation(null);
        setImageData(null);
      }
    } catch (error) {
      console.error('Error loading last violation:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLastViolation();
    
    // Refresh every 5 seconds to check for new violations
    const interval = setInterval(loadLastViolation, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const formatDateTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <Card className="w-full h-full">
        <CardHeader>
          <CardTitle>Last Violation</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!lastViolation) {
    return (
      <Card className="w-full h-full">
        <CardHeader>
          <CardTitle>Last Violation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
          <div className="text-6xl text-muted-foreground">📷</div>
          <div className="text-muted-foreground text-center">
            No recent violations found
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full h-full">
      <CardHeader>
        <CardTitle>Last Violation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center">
          {imageData ? (
            <img 
              src={imageData} 
              alt="Violation evidence" 
              className="max-w-full max-h-48 object-contain rounded"
            />
          ) : (
            <div className="w-full h-48 bg-muted rounded flex items-center justify-center">
              <span className="text-muted-foreground">Image not available</span>
            </div>
          )}
        </div>
        
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-semibold">Date & Time:</span>
            <br />
            {formatDateTime(lastViolation.timestamp)}
          </div>
          <div>
            <span className="font-semibold">Measured Speed:</span>
            <span className="ml-2 text-red-500 font-bold text-lg">
              {lastViolation.measuredSpeed} km/h
            </span>
          </div>
          <div>
            <span className="font-semibold">Speed Limit:</span>
            <span className="ml-2">
              {lastViolation.maxSpeed} km/h
            </span>
          </div>
          <div>
            <span className="font-semibold">Excess Speed:</span>
            <span className="ml-2 text-red-500 font-bold">
              +{(lastViolation.measuredSpeed - lastViolation.maxSpeed).toFixed(1)} km/h
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
