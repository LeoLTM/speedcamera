# Arduino Firmware

This submodule contains the firmware for an ESP8266 that reads two light barriers and measures the speed of passing vehicles. It sends the measurement data to the companion app using serial communication. It also controls a relay to trigger the flash when the companion app requests it when it takes a picture.

## Setup

1. Install the Platformio IDE extension in Visual Studio Code.
2. Open this folder in Visual Studio Code.
3. Connect the ESP8266 to your computer via USB.
4. Select the correct serial port in the Platformio IDE extension.
5. Click the "Upload" button in the Platformio IDE extension to upload the firmware to the ESP8266.