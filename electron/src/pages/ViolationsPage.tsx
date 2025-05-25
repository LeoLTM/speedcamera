import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import DatabaseControls from '@/components/DatabaseControls';
import { SpeedViolation } from '@/types/database';
import React from 'react';

export default function ViolationsPage() {
  const [violations, setViolations] = useState<SpeedViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [imageCache, setImageCache] = useState<Record<string, string>>({}); // Cache for image data URLs

  const loadViolations = async () => {
    try {
      setLoading(true);
      const [violationsList, count] = await Promise.all([
        window.database.getViolations(50), // Get last 50 violations
        window.database.getViolationCount()
      ]);
      setViolations(violationsList);
      setTotalCount(count);
      
      // Preload images
      const imagePromises = violationsList.map(async (violation) => {
        try {
          const imageData = await window.camera.getImageData(violation.imagePath);
          return { path: violation.imagePath, data: imageData };
        } catch (error) {
          console.error('Error loading image for violation', violation.id, error);
          return { path: violation.imagePath, data: null };
        }
      });
      
      const images = await Promise.all(imagePromises);
      const newImageCache: Record<string, string> = {};
      images.forEach(({ path, data }) => {
        if (data) {
          newImageCache[path] = data;
        }
      });
      setImageCache(newImageCache);
    } catch (error) {
      console.error('Error loading violations:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteViolation = async (id: number) => {
    try {
      const success = await window.database.deleteViolation(id);
      if (success) {
        setViolations(prev => prev.filter(v => v.id !== id));
        setTotalCount(prev => prev - 1);
      }
    } catch (error) {
      console.error('Error deleting violation:', error);
    }
  };

  const formatDateTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  useEffect(() => {
    loadViolations();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading violations...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Speed Violations</h1>
        <p className="text-muted-foreground">
          Total violations recorded: {totalCount}
        </p>
      </div>

      <DatabaseControls />

      {violations.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center text-muted-foreground">
              No speed violations recorded yet.
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="grid gap-4 pr-4">
            {violations.map((violation) => (
              <Card key={violation.id}>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <span>Violation #{violation.id}</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteViolation(violation.id)}
                    >
                      Delete
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="space-y-2">
                        <div>
                          <span className="font-semibold">Date & Time:</span>
                          <br />
                          {formatDateTime(violation.timestamp)}
                        </div>
                        <div>
                          <span className="font-semibold">Measured Speed:</span>
                          <span className="ml-2 text-red-500 font-bold">
                            {violation.measuredSpeed} km/h
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold">Speed Limit:</span>
                          <span className="ml-2">{violation.maxSpeed} km/h</span>
                        </div>
                        <div>
                          <span className="font-semibold">Excess Speed:</span>
                          <span className="ml-2 text-orange-500 font-bold">
                            +{(violation.measuredSpeed - violation.maxSpeed).toFixed(1)} km/h
                          </span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold mb-2">Evidence Photo:</div>
                      {imageCache[violation.imagePath] ? (
                        <img
                          src={imageCache[violation.imagePath]}
                          alt={`Violation ${violation.id}`}
                          className="max-w-full h-48 object-cover rounded border"
                        />
                      ) : (
                        <div className="w-full h-48 bg-gray-200 rounded border flex items-center justify-center text-gray-500">
                          Image not available
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
