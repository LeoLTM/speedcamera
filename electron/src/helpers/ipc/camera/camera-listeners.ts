import { ipcMain } from "electron";
import { CAMERA_SAVE_PICTURE_CHANNEL } from "./camera-channels";
// Import fs
import fs from "fs";

const pathToImageFolder = "savedImages/";

export function addCameraEventListeners() {
    ipcMain.handle(CAMERA_SAVE_PICTURE_CHANNEL, (e, imgEncoded: string) => {
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

        // Save the encoded image to a file
        fs.writeFile(`${pathToImageFolder}image.png`, imgBuffer, (err) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log("Picture saved successfully!");
        });
    });
}