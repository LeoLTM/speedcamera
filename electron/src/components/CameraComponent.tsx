import React, { useEffect, useRef } from 'react';
import Webcam from 'react-webcam';
import { useStore } from '@/stores/useStore';
import { toast } from 'sonner';
import { Status, StatusMessage } from '@/types/status';
import { SerialCommand, SerialCommands } from '@/types/commands';

export default function CameraComponent() {

    const { selectedCamera } = useStore();
    const { setSelectedCameraRef } = useStore();

    const webcamRef = useRef<Webcam>(null);

    useEffect(() => {
        setSelectedCameraRef(webcamRef);
    }, [setSelectedCameraRef]);

    useEffect(() => {
        window.serial.onStatus((jsonStatus) => {
            const status: StatusMessage = JSON.parse(jsonStatus);
            switch(status.status) {
                case Status.SPEEDING:
                    takePicture(webcamRef);
                    break;
                default:
                    break;
            }
        })

        return () => {
            window.serial.onStatus(() => {});
        }
    }, []);

    function takePicture(selectedCameraRef: React.RefObject<Webcam>) {
        console.log("Taking picture...");
        const imgEncoded: string | null | undefined = selectedCameraRef.current?.getScreenshot();
        const serialCommand: SerialCommand = {
            command: SerialCommands.FLASH,
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
        console.log(`${selectedCameraRef.current}`)
        if(!imgEncoded) {
            console.error("Error taking picture");
            return;
        }
        window.camera.savePicture(imgEncoded);
    }

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

