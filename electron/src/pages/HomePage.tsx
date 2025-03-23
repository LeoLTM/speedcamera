import React from "react";
import ToggleTheme from "@/components/ToggleTheme";
import LangToggle from "@/components/LangToggle";
import CameraComponent from "@/components/CameraComponent";
import CameraSelector from "@/components/CameraSelector";
import BoardSelector from "@/components/BoardSelector";
import MeasurementData from "@/components/MeasurementData";
import Devices from "@/components/Devices";


export default function HomePage() {
    return (
        <>
            <div className="flex h-screen flex-col items-center justify-center gap-2">
                <h1 className="text-4xl font-bold">
                    SpeedCamera App
                </h1>
                <ToggleTheme />
                <div className="flex flex-row gap-2">
                    <Devices />
                    <MeasurementData />
                </div>

                <CameraComponent />
            </div>
        </>
    );
}
