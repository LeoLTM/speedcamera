import CameraHwSettings from "@/components/Settings/CameraHwSettings";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import React, { useEffect, useMemo, useState } from "react";
import Webcam from "react-webcam";

export default function CameraSettingsPage() {

    const [availableCameras, setAvailableCameras] = React.useState<{ id: number; name: string }[]>([]);
    const [selectedCameraId, setSelectedCameraId] = React.useState<number | null>(null);
    const [mediaDevices, setMediaDevices] = useState<MediaDeviceInfo[]>([]);

    useEffect(() => {
        window.camera.getAvailableCameras().then((cameras) => {
            setAvailableCameras(cameras);
        }).catch((error) => {
            console.error("Error fetching available cameras:", error);
        });

        navigator.mediaDevices.enumerateDevices().then((devices) => {
            setMediaDevices(devices.filter(d => d.kind === "videoinput"));
        });
    }, []);

    // Try to match the selected v4l2 camera to a browser MediaDeviceInfo by label
    const webcamDeviceId = useMemo(() => {
        if (selectedCameraId === null) return undefined;
        const cam = availableCameras.find(c => c.id === selectedCameraId);
        if (!cam) return undefined;
        // v4l2 names end with ":" or " (usb-...)" — strip trailing colon/parens for matching
        const v4l2Name = cam.name.replace(/\s*\(.*\)\s*:?\s*$/, "").replace(/:$/, "").trim().toLowerCase();
        const match = mediaDevices.find(d =>
            d.label.toLowerCase().includes(v4l2Name)
        );
        return match?.deviceId;
    }, [selectedCameraId, availableCameras, mediaDevices]);

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-4">
            <h1 className="text-4xl font-bold">Camera Settings Page</h1>
            <Select
                value={selectedCameraId !== null ? String(selectedCameraId) : ""}
                onValueChange={(value) => setSelectedCameraId(Number(value))}
            >
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Cameras" />
                    </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                    { 
                    availableCameras.map((camera) => (
                        <SelectItem key={camera.id} value={String(camera.id)}>
                            {camera.name} (ID: {camera.id})
                        </SelectItem>
                        ))
                    }
                    </SelectGroup>
                </SelectContent>
            </Select>

            {selectedCameraId !== null && webcamDeviceId && (
                <div className="w-full max-w-lg rounded-lg overflow-hidden border">
                    <Webcam
                        key={webcamDeviceId}
                        audio={false}
                        videoConstraints={{ deviceId: { exact: webcamDeviceId } }}
                        className="w-full"
                    />
                </div>
            )}

            <div className="w-8/12">
                <CameraHwSettings cameraToControl={selectedCameraId} />
            </div>
        </div>
    );
}
