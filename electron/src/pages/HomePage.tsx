import React, { useEffect } from "react";
import ToggleTheme from "@/components/ToggleTheme";
import CameraComponent from "@/components/CameraComponent";
import Measurements from "@/components/Measurements";
import Devices from "@/components/Devices";
import { useStore } from "@/stores/useStore";
import { toast } from "sonner";
import { Status, StatusMessage } from "@/types/status";


export default function HomePage() {

    const { selectedCameraRef, lastMeasurement } = useStore();
    const { setLastMeasurement } = useStore();

    useEffect(() => {
        const handleStatus = (jsonStatus: string) => {
            const status: StatusMessage = JSON.parse(jsonStatus);
            switch(status.status) {
                case Status.JSON_ERROR:
                    toast.error(`A JSON error occurred!`);
                    break;
                case Status.FLASH:
                    toast.success(`Flash successful!`);
                    break;
                case Status.SPEEDING:
                    setLastMeasurement(status.value!);
                    break;
                case Status.LEGAL:
                    setLastMeasurement(status.value!);
                    break;
                case Status.CONFIG:
                    toast.info(`Updated max speed to ${status.value} km/h`);
                    break;
            }
        }
        window.serial.onStatus(handleStatus);

        return () => { 
            window.serial.offStatus(handleStatus);
        }
    }, [setLastMeasurement]);

    return (
        <>
            <div className="flex h-screen flex-col items-center justify-center gap-2">
                <h1 className="text-4xl font-bold">
                    SpeedCamera App
                </h1>
                <ToggleTheme />
                <div className="flex flex-row gap-2">
                    <Devices />
                    <Measurements />
                </div>

                <CameraComponent />
            </div>
        </>
    );
}
