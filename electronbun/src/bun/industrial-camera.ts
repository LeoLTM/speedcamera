import { Camera, Stream, updateDeviceList, getDevices, ArvPixelFormat } from "@asl-gokart/bun-aravis";
import sharp from "sharp";
import { getSettings } from "./database";

let camera: Camera | null = null;
let stream: Stream | null = null;
let isConnected = false;

type PushCameraStatus = (payload: { connected: boolean; vendor: string | null; model: string | null; serial: string | null }) => void;
let pushCameraStatus: PushCameraStatus | null = null;

export function initCameraPush(pushFn: PushCameraStatus) {
  pushCameraStatus = pushFn;
}

function notifyStatus() {
  if (pushCameraStatus) {
    pushCameraStatus({
      connected: isConnected,
      vendor: camera ? camera.vendor : null,
      model: camera ? camera.model : null,
      serial: camera ? camera.serialNumber : null,
    });
  }
}

export function initCamera() {
  if (isConnected) return;
  try {
    updateDeviceList();
    const devices = getDevices();
    const hikDevice = devices.find((d) => d.vendor.toLowerCase().includes("hikrobot"));
    
    if (!hikDevice && devices.length === 0) {
      console.warn("[industrial-camera] No cameras found");
      return;
    }

    camera = Camera.open(hikDevice ? hikDevice.id : undefined);
    
    try {
      camera.autoPacketSize();
    } catch (e) {
      console.warn("[industrial-camera] autoPacketSize not supported/needed");
    }

    const settings = getSettings();
    const exposure = Number(settings.cameraExposure) || 5000;
    const gain = Number(settings.cameraGain) || 0;
    const strobeDuration = Number(settings.strobeLineDuration) || 5000;

    if (camera.isFeatureAvailable("PixelFormat")) {
        try { camera.setStringFeature("PixelFormat", "RGB8"); } catch (e) {}
    }

    if (camera.isFeatureAvailable("AcquisitionMode")) {
      camera.setStringFeature("AcquisitionMode", "Continuous");
    }
    if (camera.isFeatureAvailable("TriggerMode")) {
      camera.setStringFeature("TriggerMode", "On");
      camera.setStringFeature("TriggerSource", "Software");
    }

    if (camera.isFeatureAvailable("LineSelector")) {
      try {
        camera.setStringFeature("LineSelector", "Line1");
      } catch (e) {}

      try {
        camera.setStringFeature("LineMode", "Strobe");
      } catch (e) {}

      try {
        camera.setStringFeature("LineSource", "ExposureActive");
      } catch (e) {}

      try {
        if (camera.isFeatureAvailable("StrobeEnable")) {
          camera.setIntegerFeature("StrobeEnable", 1);
          camera.setIntegerFeature("StrobeLineDuration", strobeDuration);
          camera.setIntegerFeature("StrobeLineDelay", 0);
          camera.setIntegerFeature("StrobeLinePreDelay", 0);
        }
      } catch (e) {
        console.warn("[industrial-camera] Standard Strobe features missing, relying on LineSource = ExposureActive");
      }
    }

    try {
        camera.setStringFeature("ExposureAuto", "Off");
        camera.setExposureTime(exposure);
    } catch (e) {}
    
    try {
        camera.setStringFeature("GainAuto", "Off");
        camera.setGain(gain);
    } catch (e) {}

    stream = camera.createStream(5);
    stream.startAcquisition();

    isConnected = true;
    console.log(`[industrial-camera] Connected: ${camera.vendor} ${camera.model} (${camera.serialNumber})`);
    notifyStatus();

  } catch (e) {
    console.error("[industrial-camera] Init failed:", e);
    disconnectCamera();
  }
}

export function disconnectCamera() {
  if (stream) {
    try { stream.stopAcquisition(); } catch (e) {}
    try { stream.dispose(); } catch (e) {}
    stream = null;
  }
  if (camera) {
    try { camera.dispose(); } catch (e) {}
    camera = null;
  }
  isConnected = false;
  notifyStatus();
}

export function getCameraStatus() {
  return {
    connected: isConnected,
    vendor: camera ? camera.vendor : null,
    model: camera ? camera.model : null,
    serial: camera ? camera.serialNumber : null,
  };
}

export function setExposure(value: number) {
  if (!camera || !isConnected) return;
  try {
    camera.setExposureTime(value);
  } catch (e) {
    console.error("[industrial-camera] setExposure failed", e);
  }
}

export function setGain(value: number) {
  if (!camera || !isConnected) return;
  try {
    camera.setGain(value);
  } catch (e) {
    console.error("[industrial-camera] setGain failed", e);
  }
}

export async function captureFrame(): Promise<string | null> {
  if (!camera || !stream || !isConnected) {
      console.warn("[industrial-camera] captureFrame: not connected");
      return null;
  }

  try {
    if (camera.isFeatureAvailable("TriggerSoftware")) {
      camera.executeCommand("TriggerSoftware");
    }

    const buffer = stream.timeoutPopBuffer(2_000_000); 
    if (!buffer || !buffer.isSuccess) {
      if (buffer) stream.pushBuffer(buffer);
      console.error("[industrial-camera] Capture timeout or error");
      return null;
    }

    const w = buffer.width;
    const h = buffer.height;
    const fmt = buffer.pixelFormatName; 
    const data = buffer.copyData();
    
    stream.pushBuffer(buffer);

    let sharpInst;
    if (fmt === "RGB8" || fmt === "RGB8Packed") {
        sharpInst = sharp(data, { raw: { width: w, height: h, channels: 3 } });
    } else if (fmt === "Mono8") {
        sharpInst = sharp(data, { raw: { width: w, height: h, channels: 1 } });
    } else {
        sharpInst = sharp(data, { raw: { width: w, height: h, channels: 1 } });
    }

    const pngBuffer = await sharpInst.png().toBuffer();
    return pngBuffer.toString("base64");

  } catch (e) {
    console.error("[industrial-camera] Capture frame failed:", e);
    return null;
  }
}
