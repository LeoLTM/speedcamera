import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Slider } from "../ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { CameraHwControl } from "@/types/camera";

type CameraHwSettingsProps = {
    cameraToControl: number | null;
}

export default function CameraHwSettings({ cameraToControl }: CameraHwSettingsProps) {

    const [controls, setControls] = useState<CameraHwControl[]>([]);

    const fetchControls = useCallback((cameraId: number) => {
        window.camera.getAvailableHwControls(cameraId).then((c) => {
            setControls(c);
        }).catch((error) => {
            console.error("Error fetching hardware controls for camera ", cameraId, ": ", error);
        });
    }, []);

    useEffect(() => {
        if (cameraToControl !== null) {
            fetchControls(cameraToControl);
        } else {
            setControls([]);
        }
    }, [cameraToControl, fetchControls]);

    const handleControlChange = useCallback((name: string, value: number) => {
        if (cameraToControl === null) return;
        // Optimistically update local state
        setControls(prev => prev.map(c => c.name === name ? { ...c, value } : c));
        window.camera.setHwControl(cameraToControl, name, value).catch((error) => {
            console.error(`Failed to set ${name}:`, error);
            // Re-fetch on error to get the actual state
            fetchControls(cameraToControl);
        });
    }, [cameraToControl, fetchControls]);

    const handleReset = useCallback(() => {
        if (cameraToControl === null) return;
        window.camera.resetHwControls(cameraToControl).then((updated) => {
            setControls(updated);
        }).catch((error) => {
            console.error("Failed to reset controls:", error);
        });
    }, [cameraToControl]);

    return (
        <div className="min-w-80">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <h2 className="text-lg font-semibold">Camera Hardware Controls</h2>
                    {cameraToControl !== null && controls.length > 0 && (
                        <Button variant="outline" size="sm" onClick={handleReset}>
                            Reset to defaults
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    <p className="mb-4">You have selected camera {cameraToControl !== null ? cameraToControl : "None"}.</p>
                    {
                        cameraToControl !== null ? (
                            controls.length === 0 ? (
                                <p>No hardware controls found for this camera.</p>
                            ) : (
                                <div className="grid gap-y-3" style={{ gridTemplateColumns: "minmax(0,1fr) auto 1fr" }}>
                                    {controls.map((control) => (
                                        <React.Fragment key={control.name}>
                                            {/* Name column */}
                                            <span className="self-center font-mono text-sm truncate pr-4">
                                                {control.name}
                                            </span>

                                            {/* Value (range) column */}
                                            <span className="self-center text-sm tabular-nums text-right pr-4 whitespace-nowrap">
                                                {control.type === "bool" ? (
                                                    control.value ? "on" : "off"
                                                ) : (
                                                    <>
                                                        {control.value}
                                                        <span className="text-muted-foreground">
                                                            {control.min != null && control.max != null
                                                                ? ` (${control.min}–${control.max})`
                                                                : ""}
                                                        </span>
                                                    </>
                                                )}
                                            </span>

                                            {/* Control column */}
                                            <div className="self-center">
                                                {control.type === "bool" ? (
                                                    <Switch
                                                        checked={control.value === 1}
                                                        onCheckedChange={(checked) =>
                                                            handleControlChange(control.name, checked ? 1 : 0)
                                                        }
                                                    />
                                                ) : (
                                                    <Slider
                                                        value={[control.value]}
                                                        onValueChange={([v]) =>
                                                            handleControlChange(control.name, v)
                                                        }
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