# speedcamera

This repo contains three submodules:

| Submodule | Description |
| --------- | ----------- |
| [arduino](./arduino) | The firmware for an ESP8266 that reads two light barriers and measures the speed of passing vehicles.  It sends the measurement data to the companion app using serial communication. It also controls a relay to trigger the flash when the companion app requests it when it takes a picture. |
| [electron](./electron) | The companion app made with Electron that displays the speed measurements, triggers the camera and provides a user interface for configuring the speed camera. |
| [python](./python) | Old Python code that implemented a POC for the speed camera companion app. |