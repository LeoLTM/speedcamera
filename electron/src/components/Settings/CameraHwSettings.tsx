import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Slider } from "../ui/slider";
import { Switch } from "@/components/ui/switch";
import { CameraHwControl } from "@/types/camera";

type CameraHwSettingsProps = {
    cameraToControl: number | null;
}

export default function CameraHwSettings({ cameraToControl }: CameraHwSettingsProps) {

    const [availableControls, setAvailableControls] = useState<CameraHwControl[]>([]);

    useEffect(() => {
        if(cameraToControl !== null) {
            window.camera.getAvailableHwControls(cameraToControl).then((controls) => {
                setAvailableControls(controls);
            }).catch((error) => {
                console.error("Error fetching hardware controls for camera ", cameraToControl, ": ", error);
            });
        }
    }, [cameraToControl])


    return (
        <div className="min-w-80">
            <Card>
                <CardHeader>
                    <h2 className="text-lg font-semibold">Camera Hardware Controls</h2>
                </CardHeader>
                <CardContent>
                    <p className="mb-4">You have selected camera {cameraToControl !== null ? cameraToControl : "None"}.</p>
                    {
                        cameraToControl !== null ? (
                            availableControls.length === 0 ? (
                                <p>No hardware controls found for this camera.</p>
                            ) : (
                                <div className="grid gap-y-3" style={{ gridTemplateColumns: "minmax(0,1fr) 5rem 1fr" }}>
                                    {availableControls.map((control) => (
                                        <React.Fragment key={control.name}>
                                            {/* Name column */}
                                            <span className="self-center font-mono text-sm truncate pr-4">
                                                {control.name}
                                            </span>

                                            {/* Value (range) column */}
                                            <span className="self-center text-sm tabular-nums text-right pr-24 whitespace-nowrap">
                                                {control.type === "bool" ? (
                                                    control.value ? "on" : "off"
                                                ) : (
                                                    <>
                                                        {control.value}
                                                        <span className="text-muted-foreground">
                                                            {control.min != null && control.max != null
                                                                ? ` (${control.min}–${control.max})`
                                                                : " ( - )"}
                                                        </span>
                                                    </>
                                                )}
                                            </span>

                                            {/* Control column */}
                                            <div className="self-center">
                                                {control.type === "bool" ? (
                                                    <Switch defaultChecked={control.value === 1} />
                                                ) : (
                                                    <Slider
                                                        defaultValue={[control.value]}
                                                        min={control.min ?? 0}
                                                        max={control.max ?? 100}
                                                        step={control.step ?? 1}
                                                    />
                                                )}
                                            </div>
                                        </React.Fragment>
                                    ))}
                                </div>
                            )
                        ) : (
                            <p>Please select a camera to view its hardware controls.</p>
                        )
                    }
                </CardContent>
            </Card>
        </div>
    )
}