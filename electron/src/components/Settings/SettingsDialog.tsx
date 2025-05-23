import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
  } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useStore } from "@/stores/useStore"  
import { Settings, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function SettingsDialog() {
    const { flashDelay, flashDuration, pictureDelay } = useStore();
    const { setFlashDelay, setFlashDuration, setPictureDelay } = useStore();
    const { initializedPort } = useStore(); // Get the serialPort status

    // Local state to track changes before saving
    const [newFlashDelay, setNewFlashDelay] = useState(flashDelay);
    const [newFlashDuration, setNewFlashDuration] = useState(flashDuration);
    const [newPictureDelay, setNewPictureDelay] = useState(pictureDelay);
    const [isOpen, setIsOpen] = useState(false);
    
    // Detect if any values have changed and if a serial port is open
    const hasChanges = 
        newFlashDelay !== flashDelay ||
        newFlashDuration !== flashDuration ||
        newPictureDelay !== pictureDelay;
        
    // Check if a port is initialized
    const isPortOpen = initializedPort !== null;

    // Reset local values when dialog opens
    useEffect(() => {
        if (isOpen) {
            setNewFlashDelay(flashDelay);
            setNewFlashDuration(flashDuration);
            setNewPictureDelay(pictureDelay);
        }
    }, [isOpen, flashDelay, flashDuration, pictureDelay]);

    function validateFlashDelay(value: number): boolean {
        if(isNaN(value) || value < 1 || value > 5000) {
            toast.error("Flash delay must be a number between 1 and 5000");
            return false;
        }
        return true;
    }

    function validateFlashDuration(value: number): boolean {
        if(isNaN(value) || value < 1 || value > 2500) {
            toast.error("Flash duration must be a number between 1 and 2500");
            return false;
        }
        return true;
    }

    function validatePictureDelay(value: number): boolean {
        if(isNaN(value) || value < 1 || value > 2500) {
            toast.error("Picture delay must be a number between 1 and 2500");
            return false;
        }
        return true;
    }

    function handleSaveSettings() {
        // First check if a port is open
        if (!isPortOpen) {
            toast.error("Cannot save settings: No serial port connection is open");
            return;
        }
        
        let isValid = true;
        
        // Validate all values before saving
        if (!validateFlashDelay(newFlashDelay)) isValid = false;
        if (!validateFlashDuration(newFlashDuration)) isValid = false;
        if (!validatePictureDelay(newPictureDelay)) isValid = false;
        
        if (isValid) {
            // Save all values at once
            setFlashDelay(newFlashDelay);
            setFlashDuration(newFlashDuration);
            setPictureDelay(newPictureDelay);
            toast.success("Settings saved successfully");
        }
    }

    return (
        <>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger>
                    <Button size="icon">
                        <Settings />
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Settings</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-row gap-2 items-center">
                            <p>Flash Delay (ms)</p>
                            <Input 
                                type="number" 
                                min={1} 
                                max={5000} 
                                value={newFlashDelay}
                                onChange={(v) => setNewFlashDelay(Number(v.target.value))} 
                            />
                        </div>
                        <div className="flex flex-row gap-2 items-center">
                            <p>Flash Duration (ms)</p>
                            <Input 
                                type="number" 
                                min={1} 
                                max={2500} 
                                value={newFlashDuration}
                                onChange={(v) => setNewFlashDuration(Number(v.target.value))} 
                            />
                        </div>
                        <div className="flex flex-row gap-2 items-center">
                            <p>Picture Delay (ms)</p>
                            <Input 
                                type="number" 
                                min={1} 
                                max={2500} 
                                value={newPictureDelay}
                                onChange={(v) => setNewPictureDelay(Number(v.target.value))} 
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button 
                            onClick={handleSaveSettings}
                            disabled={!hasChanges || !isPortOpen}
                            className="w-full"
                            title={!isPortOpen ? "Connect a serial port to save settings" : "Save changes"}
                        >
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                        </Button>
                        {!isPortOpen && (
                            <p className="text-xs text-red-500 mt-2 w-full text-center">
                                Connect a serial port to save settings
                            </p>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}