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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"
import { Status, StatusMessage } from "@/types/status";
import { SerialCommand, SerialCommands } from "@/types/commands";
  

export default function Measurements() {

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
    });

    function handleSetMaxSpeed(maxSpeed: number) {
        // Check if maxSpeed is a number and between 1 and 199
        if(isNaN(maxSpeed) || maxSpeed < 1 || maxSpeed > 199) {
            toast("Max speed must be a number between 1 and 199");
            return;
        }
        const serialCommand: SerialCommand = {
            command: SerialCommands.SET_MAX_SPEED,
            value: maxSpeed,
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
        setMaxSpeed(maxSpeed);
    }


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
                <Input type="number" defaultValue={maxSpeed} min={1} max={199} onChange={(v) => handleSetMaxSpeed(Number(v.target.value))} />
            </CardContent>
        </Card>
        </>
    )

}