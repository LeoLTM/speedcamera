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
import { SerialCommand, SerialCommands } from "@/types/commands";

export default function BoardSelector() {

    const { availablePorts, selectedPort, initializedPort } = useStore();
    const { setAvailablePorts, setSelectedPort, setInitializedPort } = useStore();

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
                setInitializedPort(portPath);
            } else {
                console.error("Failed to connect to board: ", portPath);
                toast("Failed to connect to board: " + portPath);
                setInitializedPort(undefined);
            }
        } catch (e) {
            console.error("Failed to connect to board: ", e);
            toast("Failed to connect to board: " + portPath);
            setInitializedPort(undefined);
        }
    }

    function disconnectFromBoard() {
        console.log("Disconnecting from board...");
        try {
            if(window.serial.closePort()) {
                console.log("Disconnected from board.");
                toast("Disconnected from board.");
                setInitializedPort(undefined);
            } else {
                console.error("Failed to disconnect from board.");
                toast("Failed to disconnect from board.");
            }
        } catch (e) {
            console.error("Failed to disconnect from board: ", e);
            toast("Failed to disconnect from board.");
        }
    }

    function sendCommand(command: SerialCommands) {
        console.log("Sending command: ", command);
        const serialCommand: SerialCommand = {
            command: command
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
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
            { !initializedPort &&
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
            }
            {
                initializedPort &&
                <Button
                    onClick={async () => {
                        setInitializedPort(undefined);
                        disconnectFromBoard();
                        toast("Disconnected from board.");
                    }}
                >
                    Disconnect
                </Button>
            }

            <Button
                onClick={async () => {
                    if (!initializedPort) {
                        toast("Please connect to a board first.");
                        return;
                    }
                    sendCommand(SerialCommands.FLASH);
                }}
                disabled={!selectedPort}
            >
                Test Flash
            </Button>
        </div>
    )
}