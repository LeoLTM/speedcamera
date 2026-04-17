import CameraHwSettings from "@/components/Settings/CameraHwSettings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraHwControl } from "@/types/camera";
import React, { useEffect } from "react";

export default function CameraSettingsPage() {

    const [availableCameras, setAvailableCameras] = React.useState<{ id: number; name: string }[]>([]);
    const [selectedCameraId, setSelectedCameraId] = React.useState<number | null>(null);

    useEffect(() => {
        // Fetch available cameras
        window.camera.getAvailableCameras().then((cameras) => {
            setAvailableCameras(cameras);
        }).catch((error) => {
            console.error("Error fetching available cameras:", error);
        });
    }, []);

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-2">
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
            <div className="w-8/12">
                <CameraHwSettings cameraToControl={selectedCameraId} />
            </div>
        </div>
    );
}
