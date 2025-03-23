import React, { useEffect } from "react";
import { useStore } from "@/stores/useStore";
import { toast } from "sonner";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
  } from "@/components/ui/card"
import { last } from "@tanstack/react-router/dist/esm/utils";
import { Button } from "./ui/button";
import { Status, StatusMessage } from "@/types/status";
  

export default function MeasurementData() {

    const { lastMeasurement, maxSpeed } = useStore();
    const { setLastMeasurement, setMaxSpeed } = useStore();

    useEffect(() => {
        window.serial.onStatus((jsonStatus) => {
            const status: StatusMessage = JSON.parse(jsonStatus);
            console.log(`Received status: ${status.status}`);
            switch(status.status) {
                case Status.LEGAL:
                    if(status.value) setLastMeasurement(status.value);
                    break;
                case Status.SPEEDING:
                    if(status.value) setLastMeasurement(status.value);
                    break;
                case Status.CONFIG:
                    if(status.value) toast(`Updated max speed to ${status.value} km/h`);
                    break;
                default:
                    break;
            }
        })
    })

    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle>Measurements</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Max. Speed: {maxSpeed} km/h</p>
                <div className="flex flex-row justify-between">
                    <p className="pr-1">Last Measurement:</p>
                    {
                        lastMeasurement && lastMeasurement > maxSpeed ?
                        <p className="text-red-500">{lastMeasurement} km/h</p>
                        :
                        <p className="text-green-500">{lastMeasurement ? `${lastMeasurement}` : "---"} km/h</p>
                    }
                </div>
                <Button
                    onClick={() => {
                        const measurement = Math.floor(Math.random() * 10) + 1;
                        setLastMeasurement(measurement);
                    }}
                >
                    Generate Measurement
                </Button>
            </CardContent>
        </Card>
        </>
    )

}