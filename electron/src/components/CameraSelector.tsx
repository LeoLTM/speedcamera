import React, { useEffect } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select"
import { useStore } from '@/stores/useStore';

export default function CameraSelector() {

    const { availableCameras, selectedCamera } = useStore();
    const { setAvailableCameras, setSelectedCamera } = useStore();

    function getAvailableCameras(): Promise<MediaDeviceInfo[]> {
        return navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                return devices.filter(device => device.kind === "videoinput");
            });
    }

    useEffect(() => {
        console.log("CameraSelector mounted");
        console.log("Getting available cameras...");
        const cameras = getAvailableCameras();
        cameras.then(cameras => {
            console.log("Available cameras: ", cameras);
            setAvailableCameras(cameras);
        });
        return () => {
            console.log("CameraSelector unmounted");
        };
    }, []);

    return (
        <div>
            <Select 
                onValueChange={
                    (c) => {
                        const camera: MediaDeviceInfo | undefined = availableCameras.find(camera => camera.deviceId === c);
                        setSelectedCamera(camera)
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
        </div>
    )
}