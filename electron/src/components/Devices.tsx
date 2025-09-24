import React from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
  } from "@/components/ui/card"
import BoardSelector from "./BoardSelector";
import CameraSelector from "./CameraSelector";

  export default function Devices() {
    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle>Devices</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <CameraSelector />
                <BoardSelector />
            </CardContent>
        </Card>
        </>
    )
  }