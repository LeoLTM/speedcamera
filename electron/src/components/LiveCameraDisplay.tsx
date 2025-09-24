import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import CameraComponent from '@/components/CameraComponent';

export default function LiveCameraDisplay() {
  return (
    <Card className="w-full h-full">
      <CardHeader>
        <CardTitle>Live Camera Feed</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center">
        <div className="w-full max-w-md">
          <CameraComponent />
        </div>
      </CardContent>
    </Card>
  );
}
