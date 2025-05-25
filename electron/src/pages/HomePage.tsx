import React, { useEffect } from "react";
import ToggleTheme from "@/components/ToggleTheme";
import LiveCameraDisplay from "@/components/LiveCameraDisplay";
import LastViolationDisplay from "@/components/LastViolationDisplay";
import Measurements from "@/components/Measurements";
import Devices from "@/components/Devices";
import { useStore } from "@/stores/useStore";
import { toast } from "sonner";
import { Status, StatusMessage } from "@/types/status";


export default function HomePage() {

    const { selectedCameraRef, lastMeasurement, setLastMeasurement } = useStore();

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
            <div className="flex h-screen flex-col gap-4 p-4">
                <div className="flex flex-col items-center gap-2">
                    <h1 className="text-4xl font-bold">
                        SpeedCamera App
                    </h1>
                    <ToggleTheme />
                    <div className="flex flex-row gap-2">
                        <Devices />
                        <Measurements />
                    </div>
                </div>

                <div className="flex flex-1 gap-4">
                    <div className="flex-1">
                        <LiveCameraDisplay />
                    </div>
                    <div className="flex-1">
                        <LastViolationDisplay />
                    </div>
                </div>
            </div>
        </>
    );
}
