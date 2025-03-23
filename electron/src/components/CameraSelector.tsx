import React, { useEffect } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select"
import { useStore } from '@/stores/useStore';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RefreshCcw } from 'lucide-react';

export default function CameraSelector() {

    const { availableCameras, selectedCamera, selectedCameraRef } = useStore();
    const { setAvailableCameras, setSelectedCamera } = useStore();

    function getAvailableCameras(): Promise<MediaDeviceInfo[]> {
        return navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                return devices.filter(device => device.kind === "videoinput");
            });
    }

    useEffect(() => {
        console.log("Getting available cameras...");
        const cameras = getAvailableCameras();
        cameras.then(cameras => {
            console.log("Available cameras: ", cameras);
            setAvailableCameras(cameras);        
        });
    }, []);

    return (
        <div className='flex flex-col gap-2'>
            <Select 
                onValueChange={
                    (c) => {
                        const camera: MediaDeviceInfo | undefined = availableCameras.find(camera => camera.deviceId === c);
                        setSelectedCamera(camera);
                        toast("Selected camera: " + camera?.label);
                    }
                }>
            <SelectTrigger className="w-[360px]">
                <SelectValue placeholder="Select Camera" />
            </SelectTrigger>
            <SelectContent>
                {availableCameras.map(camera => (
                    <SelectItem key={camera.deviceId} value={camera.deviceId}>{camera.label}</SelectItem>
                ))}
            </SelectContent>
            </Select>

            <div className='flex flex-row gap-1'>
                <Button
                    onClick={() => {
                        console.log("Refreshing cameras...");
                        const cameras = getAvailableCameras();
                        cameras.then(cameras => {
                            console.log("Available cameras: ", cameras);
                            setAvailableCameras(cameras);        
                        });
                    }}
                >
                    Refresh Cameras
                    <RefreshCcw />
                </Button>
                {   (selectedCamera && selectedCameraRef) &&
                    <Button
                        disabled={!selectedCameraRef.current}
                        onClick={() => {
                            console.log("Taking picture...");
                            const imgEncoded: string | null | undefined = selectedCameraRef.current?.getScreenshot();
                            console.log(`${selectedCameraRef.current}`)
                            if(!imgEncoded) {
                                console.error("Error taking picture");
                                return;
                            }
                            window.camera.savePicture(imgEncoded);

                        }}
                    >
                        Take Picture
                    </Button>
                }
            </div>
        </div>
    )
}