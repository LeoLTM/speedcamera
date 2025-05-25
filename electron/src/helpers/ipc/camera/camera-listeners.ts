import { ipcMain } from "electron";
import { CAMERA_SAVE_PICTURE_CHANNEL, CAMERA_GET_IMAGE_DATA_CHANNEL } from "./camera-channels";
// Import fs and path
import fs from "fs";
import path from "path";

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
}