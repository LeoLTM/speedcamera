import { ipcMain } from "electron";
import { CAMERA_SAVE_PICTURE_CHANNEL, CAMERA_GET_IMAGE_DATA_CHANNEL, CAMERA_GET_AVAILABLE_HW_CONTROLS_CHANNEL, CAMERA_SET_HW_CONTROL_CHANNEL, CAMERA_GET_HW_CONTROL_CHANNEL, CAMERA_GET_AVAILABLE_CAMERAS_CHANNEL } from "./camera-channels";
// Import fs and path
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { CameraHwControl, parseV4l2CtlOutput } from "@/types/camera";

const pathToImageFolder = "savedImages/";

export function addCameraEventListeners() {
    ipcMain.handle(CAMERA_SAVE_PICTURE_CHANNEL, (e, imgEncoded: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            console.log("Saving picture in main..."); 

            // Remove the data URL prefix if it exists
            const base64Data = imgEncoded.replace(/^data:image\/\w+;base64,/, "");

            // Decode the base64 string
            const imgBuffer = Buffer.from(base64Data, "base64");

            // Check if the folder exists, if not create it
            if (!fs.existsSync(pathToImageFolder)) {
                console.log(`Folder ${pathToImageFolder} does not exist, creating it...`);
                fs.mkdirSync(pathToImageFolder);
                console.log("Folder created successfully!");
            }

            // Generate unique filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `speed-violation-${timestamp}.png`;
            const fullPath = path.resolve(pathToImageFolder, filename);

            // Save the encoded image to a file
            fs.writeFile(fullPath, imgBuffer, (err) => {
                if (err) {
                    console.error(err);
                    reject(err);
                    return;
                }
                console.log("Picture saved successfully!");
                resolve(fullPath);
            });
        });
    });

    // Handle getting image data as base64 for renderer
    ipcMain.handle(CAMERA_GET_IMAGE_DATA_CHANNEL, (e, imagePath: string): Promise<string | null> => {
        return new Promise((resolve) => {
            try {
                // Check if file exists
                if (!fs.existsSync(imagePath)) {
                    console.error('Image file not found:', imagePath);
                    resolve(null);
                    return;
                }

                // Read the file and convert to base64
                const imageBuffer = fs.readFileSync(imagePath);
                const base64Data = imageBuffer.toString('base64');
                const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
                const dataUrl = `data:${mimeType};base64,${base64Data}`;
                
                resolve(dataUrl);
            } catch (error) {
                console.error('Error reading image file:', error);
                resolve(null);
            }
        });
    });

    ipcMain.handle(CAMERA_GET_AVAILABLE_CAMERAS_CHANNEL, async (): Promise<{ id: number; name: string }[]> => {
        const stdout = await new Promise<string>((resolve, reject) => {
            execFile("v4l2-ctl", ["--list-devices"], (error, stdout, stderr) => {
                if (error) {
                    console.error("v4l2-ctl error:", stderr);
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });

        const candidates: { id: number; name: string }[] = [];
        const deviceBlocks = stdout.split("\n\n");
        for (const block of deviceBlocks) {
            const lines = block.split("\n").filter(line => line.trim() !== "");
            if (lines.length > 0) {
                const name = lines[0].trim();
                const idMatch = lines[1]?.match(/\/dev\/video(\d+)/);
                if (idMatch) {
                    candidates.push({ id: Number(idMatch[1]), name });
                }
            }
        }

        const results = await Promise.allSettled(
            candidates.map(async (cam) => {
                const controls = await parseV4l2CtlDeviceControls(cam.id);
                return controls.length > 0 ? cam : null;
            })
        );

        return results
            .filter((r): r is PromiseFulfilledResult<{ id: number; name: string }> =>
                r.status === "fulfilled" && r.value !== null
            )
            .map(r => r.value);
    });


    // Handle getting available hardware controls for the selected camera
    ipcMain.handle(CAMERA_GET_AVAILABLE_HW_CONTROLS_CHANNEL, async (e, cameraId: number): Promise<CameraHwControl[]> => {
        console.log(`Fetching hardware controls for camera ID ${cameraId}...`);
        const deviceControls: CameraHwControl[] = await parseV4l2CtlDeviceControls(cameraId);
        console.log(`Found ${deviceControls.length} controls for camera ID ${cameraId}.`);
        console.log("Controls:", deviceControls);
        return deviceControls;
    });

    ipcMain.handle(CAMERA_SET_HW_CONTROL_CHANNEL, (e, cameraId: number, controlName: string, value: number): Promise<void> => {
        return new Promise((resolve, reject) => {
            execFile("v4l2-ctl", ["-d", String(cameraId), "-c", `${controlName}=${value}`], (error, stdout, stderr) => {
                if (error) {
                    console.error(`Failed to set control ${controlName}:`, stderr);
                    reject(error);
                    return;
                }
                console.log(`Control ${controlName} set to ${value} successfully.`);
                resolve();
            });
        });
    });

    ipcMain.handle(CAMERA_GET_HW_CONTROL_CHANNEL, (e, cameraId: number, controlName: string): Promise<number> => {
        return new Promise((resolve, reject) => {
            execFile("v4l2-ctl", ["-d", String(cameraId), "-C", controlName], (error, stdout, stderr) => {
                if (error) {
                    console.error(`Failed to get control ${controlName}:`, stderr);
                    reject(error);
                    return;
                }
                const match = stdout.match(/Value:\s*(-?\d+)/);
                if (match) {
                    const value = Number(match[1]);
                    console.log(`Control ${controlName} has value ${value}.`);
                    resolve(value);
                } else {
                    const errorMsg = `Unexpected output when getting control ${controlName}: ${stdout}`;
                    console.error(errorMsg);
                    reject(new Error(errorMsg));
                }
            });
        });
    });
};

function parseV4l2CtlDeviceControls(cameraId: number): Promise<CameraHwControl[]> {
    return new Promise((resolve, reject) => {
        execFile("v4l2-ctl", ["-d", String(cameraId), "-l"], (error, stdout, stderr) => {
            if (error) {
                console.error("v4l2-ctl error:", stderr);
                reject(error);
                return;
            }
            try {
                resolve(parseV4l2CtlOutput(stdout));
            } catch (parseError) {
                console.error("Failed to parse v4l2-ctl output:", parseError);
                reject(parseError);
            }
        });
    });
};