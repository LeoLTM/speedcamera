import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PortInfo } from "@serialport/bindings-cpp";
import { useStore } from "@/stores/useStore";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select"
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";

export default function BoardSelector() {

    const { availablePorts, selectedPort } = useStore();
    const { setAvailablePorts, setSelectedPort } = useStore();

    useEffect(() => {
        console.log("Getting available boards...");
        const boards = getAvailableESPDevices();
        boards.then(boards => {
            console.log("Available boards: ", boards);
            setAvailablePorts(boards);
        });
    }, []);

    async function getAvailableESPDevices(): Promise<PortInfo[]> {
        const ports: PortInfo[] = await window.serial.listPorts();
        console.log("Available serial devices: ");
        console.log(ports);
        return ports;
    }

    async function connectToBoard(portPath: string) {
        console.log("Connecting to board: ", portPath);
        try {
            if(await window.serial.openPort(portPath)) {
                console.log("Connected to board: ", portPath);
                toast("Connected to board: " + portPath);
            }
        } catch (e) {
            console.error("Failed to connect to board: ", e);
            toast("Failed to connect to board: " + portPath);
        }
    }

    return (
        <div>
            <Select
                onValueChange={
                    (p) => {
                        setSelectedPort(p);
                        toast("Selected port: " + p);
                    }
                }
            >
                <SelectTrigger className="w-[360px]">
                    <SelectValue placeholder="Select Port" />
                </SelectTrigger>
                <SelectContent>
                    {availablePorts.map(port => (
                        <SelectItem key={port.locationId} value={port.path}>{port.path}</SelectItem>
                    ))}
                </SelectContent>                
            </Select>
            <Button
                onClick={async () => {
                    const boards = await getAvailableESPDevices();
                    setAvailablePorts(boards);
                }}
            >
                Refresh Boards
                <RefreshCcw />
            </Button>
            <Button
                onClick={async () => {
                    if (!selectedPort) {
                        toast("Please select a port first.");
                        return;
                    }
                    await connectToBoard(selectedPort);
                }}
                disabled={!selectedPort}
            >
                Connect
            </Button>
        </div>
    )
}