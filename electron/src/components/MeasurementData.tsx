import React from "react";
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
  

export default function MeasurementData() {

    const { lastMeasurement, maxSpeed } = useStore();
    const { setLastMeasurement, setMaxSpeed } = useStore();

    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle>Measurements</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Max. Speed: {maxSpeed} km/h</p>
                <p>Last Measurement: {lastMeasurement ? (`${lastMeasurement} km/h`) : "---"}</p>
            </CardContent>
        </Card>
        </>
    )

}