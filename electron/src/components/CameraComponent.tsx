import React, { useEffect, useRef } from 'react';
import Webcam from 'react-webcam';
import { useStore } from '@/stores/useStore';
import { toast } from 'sonner';

export default function CameraComponent() {

    const { selectedCamera } = useStore();
    const { setSelectedCameraRef } = useStore();

    const webcamRef = useRef<Webcam>(null);

    useEffect(() => {
        setSelectedCameraRef(webcamRef);
    }, [setSelectedCameraRef]);

    return (
        <div className='w-4/5 h-4/5'>
            <Webcam
                audio={false}
                ref={webcamRef}
                videoConstraints={{
                    deviceId: selectedCamera?.deviceId
                }}
                disablePictureInPicture={true}
                forceScreenshotSourceSize={true}
                onUserMediaError={(e) => {
                    console.error("Camera Compnent error: ", e)
                    toast("Camera error: " + e.toString())
                }}
                screenshotFormat='image/jpeg'
                screenshotQuality={1}
             />
        </div>
    )
}

