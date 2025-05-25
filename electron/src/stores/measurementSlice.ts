import { playBeepSound } from '@/helpers/sound/audio';
import { SerialCommand, SerialCommands } from '@/types/commands';
import { StateCreator } from 'zustand';
import { CameraSlice } from './cameraSlice';
import Webcam from 'react-webcam';

export interface MeasurementSlice {
    lastMeasurement: number | null;
    maxSpeed: number;
    setLastMeasurement: (measurement: number) => void;
    setMaxSpeed: (speed: number) => void;
}

async function takePicture(selectedCameraRef: React.RefObject<Webcam>, delay: number, measuredSpeed: number, maxSpeed: number) {
    console.log("Taking picture...");
    const serialCommand: SerialCommand = {
        command: SerialCommands.FLASH,
    };
    window.serial.sendCommand(JSON.stringify(serialCommand));
    
    // Wait for the specified delay
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const imgEncoded: string | null | undefined = selectedCameraRef.current?.getScreenshot();
    if(!imgEncoded) {
        console.error("Error taking picture");
        return;
    }
    
    try {
        // Save picture and get the path
        const imagePath = await window.camera.savePicture(imgEncoded);
        
        // Save violation to database
        const violation = await window.database.addViolation({
            measuredSpeed,
            maxSpeed,
            imagePath
        });
        
        console.log("Speed violation saved:", violation);
    } catch (error) {
        console.error("Error saving violation:", error);
    }
}

export const createMeasurementSlice: StateCreator<
    MeasurementSlice & CameraSlice,
    [],
    [],
    MeasurementSlice
> = (set, get) => ({
    lastMeasurement: null,
    maxSpeed: 2,
    setLastMeasurement: (measurement: number) => {
        const { maxSpeed } = get();
        const { selectedCameraRef, pictureDelay } = get();
        // Check if the measurement is higher than the max speed
        // and send a flash command to the ESP32
        if (measurement > maxSpeed) {   
            // playBeepSound();
            takePicture(selectedCameraRef!, pictureDelay, measurement, maxSpeed);
        }
        set({ lastMeasurement: measurement });
    },
    setMaxSpeed: (speed: number) => {
        const serialCommand: SerialCommand = {
            command: SerialCommands.SET_MAX_SPEED,
            value: speed,
        };
        window.serial.sendCommand(JSON.stringify(serialCommand));
        set({ maxSpeed: speed });
    }
})