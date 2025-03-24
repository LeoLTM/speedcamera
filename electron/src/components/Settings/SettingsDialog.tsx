import React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useStore } from "@/stores/useStore"  
import { Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function SettingsDialog() {

    const { flashDelay, flashDuration, pictureDelay } = useStore();
    const { setFlashDelay, setFlashDuration, setPictureDelay } = useStore();

    function handleSetFlashDelay(flashDelay: number) {
        // Check if is a number and between 1 and 199
        if(isNaN(flashDelay) || flashDelay < 1 || flashDelay > 5000) {
            toast.error("Flöash delay must be a number between 1 and 5000");
            return;
        }
        setFlashDelay(flashDelay);
    }

    function handleSetFlashDuration(flashDuration: number) {
        // Check if is a number and between 1 and 199
        if(isNaN(flashDuration) || flashDuration < 1 || flashDuration > 2500) {
            toast.error("Flash duration must be a number between 1 and 2500");
            return;
        }
        setFlashDuration(flashDuration);
    }

    function handleSetPictureDelay(pictureDelay: number) {
        // Check if is a number and between 1 and 199
        if(isNaN(pictureDelay) || pictureDelay < 1 || pictureDelay > 2500) {
            toast.error("Picture delay must be a number between 1 and 2500");
            return;
        }
        setPictureDelay(pictureDelay);
    }

    return (
        <>
            <Dialog>
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
                            <Input type="number" min={1} max={5000} defaultValue={flashDelay} onChange={(v) => {handleSetFlashDelay(Number(v.target.value))}} />
                        </div>
                        <div className="flex flex-row gap-2 items-center">
                            <p>Flash Duration (ms)</p>
                            <Input type="number" min={1} max={2500} defaultValue={flashDuration} onChange={(v) => {handleSetFlashDuration(Number(v.target.value))}} />
                        </div>
                        <div className="flex flex-row gap-2 items-center">
                            <p>Picture Delay (ms)</p>
                            <Input type="number" min={1} max={2500} defaultValue={pictureDelay} onChange={(v) => {handleSetPictureDelay(Number(v.target.value))}} />
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}