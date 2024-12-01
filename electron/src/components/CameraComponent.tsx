import React from 'react';
import Webcam from 'react-webcam';
import { useStore } from '@/stores/useStore';

export default function CameraComponent() {

    const { selectedCamera } = useStore();

    return (
        <div>
            <Webcam
                audio={false}
                videoConstraints={{
                    deviceId: selectedCamera?.deviceId
                }}
                disablePictureInPicture={true}
                forceScreenshotSourceSize={true}
                onUserMediaError={(e) => console.error("UserMediaError: ", e)}
                screenshotFormat='image/jpeg'
                screenshotQuality={1}
             />
        </div>
    )
}

