import { Camera, Stream, updateDeviceList, getDevices } from "@asl-gokart/bun-aravis";
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
    } catch {
      console.warn("[industrial-camera] autoPacketSize not supported/needed");
    }

    const settings = getSettings();
    const exposure = Number(settings.cameraExposure) || 5000;
    const gain = Number(settings.cameraGain) || 0;
    const strobeDuration = Number(settings.strobeLineDuration) || 5000;

    const exposureAuto = settings.exposureAuto || "Off";
    const gainAuto = settings.gainAuto || "Off";

    if (camera.isFeatureAvailable("PixelFormat")) {
        setPixelFormat(settings.pixelFormat);
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
      } catch {
        /* ignore */
      }

      try {
        camera.setStringFeature("LineMode", "Strobe");
      } catch {
        /* ignore */
      }

      try {
        camera.setStringFeature("LineSource", "ExposureActive");
      } catch {
        /* ignore */
      }

      try {
        if (camera.isFeatureAvailable("StrobeEnable")) {
          try { camera.setBooleanFeature("StrobeEnable", true); }
          catch { camera.setIntegerFeature("StrobeEnable", 1); }
          
          camera.setIntegerFeature("StrobeLineDuration", strobeDuration);
          camera.setIntegerFeature("StrobeLineDelay", 0);
          camera.setIntegerFeature("StrobeLinePreDelay", 0);
        }
      } catch {
        console.warn("[industrial-camera] Standard Strobe features missing, relying on LineSource = ExposureActive");
      }
    }

    try {
        camera.setStringFeature("ExposureAuto", exposureAuto);
        if (exposureAuto === "Off") {
            camera.setExposureTime(exposure);
        }
    } catch {
        /* ignore */
    }
    
    try {
        camera.setStringFeature("GainAuto", gainAuto);
        if (gainAuto === "Off") {
            camera.setGain(gain);
        }
    } catch {
        /* ignore */
    }

    // additional features based on DB
    if (settings.frameRate) {
        try { 
            camera.setBooleanFeature("AcquisitionFrameRateEnable", true);
            camera.setFrameRate(Number(settings.frameRate)); 
        } catch {
            /* ignore */
        }
    }
    if (settings.cameraWidth) {
        try { camera.setIntegerFeature("Width", Number(settings.cameraWidth)); } catch { /* ignore */ }
    }
    if (settings.cameraHeight) {
        try { camera.setIntegerFeature("Height", Number(settings.cameraHeight)); } catch { /* ignore */ }
    }
    if (settings.blackLevel !== undefined && settings.blackLevel !== null && settings.blackLevel.toString() !== "") {
        try { camera.setIntegerFeature("BlackLevel", Number(settings.blackLevel)); } catch { /* ignore */ }
    }

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
    try { stream.stopAcquisition(); } catch { /* ignore */ }
    try { stream.dispose(); } catch { /* ignore */ }
    stream = null;
  }
  if (camera) {
    try { camera.dispose(); } catch { /* ignore */ }
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
    // Clear any stale frames from the buffer queue
    let staleBuffer;
    while ((staleBuffer = stream.tryPopBuffer()) !== null) {
      console.warn("[industrial-camera] Discarding stale frame before new capture");
      stream.pushBuffer(staleBuffer);
    }

    if (camera.isFeatureAvailable("TriggerSoftware")) {
      camera.executeCommand("TriggerSoftware");
    }

    // Non-blocking wait loop with deadline to prevent freezing the Bun event loop
    const deadline = Date.now() + 2000;
    let buffer = null;
    while (Date.now() < deadline) {
      buffer = stream.tryPopBuffer();
      if (buffer) break;
      await new Promise((r) => setTimeout(r, 10));
    }

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

export function applyMfsConfig(mfsContent: string, saveAsDefault: boolean): { applied: string[], failed: string[] } {
  if (!camera || !isConnected) return { applied: [], failed: [] };
  const result = camera.applyMfsConfig(mfsContent);
  if (saveAsDefault) {
    try {
      camera.saveUserSet("UserSet1", true);
    } catch (e) {
      console.warn("Failed to save UserSet", e);
    }
  }
  return result;
}

let setupStreamLoopActive = false;

export async function startSetupStream(pushFrame: (base64: string) => void) {
  if (!camera || !stream || !isConnected) return;
  setupStreamLoopActive = true;

  try { stream.stopAcquisition(); } catch { /* ignore */ }

  try { camera.setIntegerFeature("StrobeEnable", 0); } catch { /* ignore */ }
  try { camera.setStringFeature("TriggerMode", "Off"); } catch { /* ignore */ }
  try { camera.setStringFeature("GainAuto", "Continuous"); } catch { /* ignore */ }
  try { camera.setStringFeature("ExposureAuto", "Continuous"); } catch { /* ignore */ }
  
  // Cap camera frame rate during setup preview to 10 FPS to prevent GigE network flood
  try {
    camera.setBooleanFeature("AcquisitionFrameRateEnable", true);
    camera.setFrameRate(10);
  } catch { /* ignore */ }

  // Disable strobe properly by turning off StrobeEnable and unlinking LineSource
  try { camera.setBooleanFeature("StrobeEnable", false); } catch {
    try { camera.setIntegerFeature("StrobeEnable", 0); } catch { /* ignore */ }
  }
  
  if (camera.isFeatureAvailable("LineSelector")) {
    for (const line of ["Line1", "Line2"]) {
      try { 
        camera.setStringFeature("LineSelector", line); 
        camera.setStringFeature("LineSource", "Off");
      } catch { /* ignore */ }
    }
  }

  try { stream.startAcquisition(); } catch { /* ignore */ }

  pumpSetupFrames(pushFrame);
}

async function pumpSetupFrames(pushFrame: (base64: string) => void) {
  let isProcessing = false;

  while (setupStreamLoopActive && stream && camera) {
    try {
      // Non-blocking tryPopBuffer ensures Bun event loop is never frozen by C FFI
      const buffer = stream.tryPopBuffer();
      if (!buffer) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }

      if (!buffer.isSuccess) {
        stream.pushBuffer(buffer);
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }

      // If previous frame encoding/sending is still running, drop this frame to prevent buffer lag
      if (isProcessing) {
        stream.pushBuffer(buffer);
        continue;
      }

      isProcessing = true;
      const w = buffer.width;
      const h = buffer.height;
      const fmt = buffer.pixelFormatName;
      const data = buffer.copyData();
      stream.pushBuffer(buffer);

      let sharpInst;
      if (fmt === "RGB8" || fmt === "RGB8Packed") {
          sharpInst = sharp(data, { raw: { width: w, height: h, channels: 3 } });
      } else {
          // For Mono8 or Bayer BG (we treat Bayer as mono if we don't properly debayer here, 
          // or sharp can handle it if we specify 1 channel)
          sharpInst = sharp(data, { raw: { width: w, height: h, channels: 1 } });
      }

      // Downscale setup preview frame to max 800px width and compress to 60% quality JPEG
      // to avoid CPU saturation on Pi and avoid saturating Wi-Fi AP bandwidth
      const jpegBuffer = await sharpInst
        .resize(800, null, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();

      pushFrame(jpegBuffer.toString("base64"));
      isProcessing = false;

      // Throttle preview delivery to ~10 FPS
      await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      isProcessing = false;
      console.error("Setup stream pump error", e);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

export function stopSetupStream() {
  setupStreamLoopActive = false;
  if (!camera || !stream || !isConnected) return;

  try { stream.stopAcquisition(); } catch { /* ignore */ }

  // Restore settings to those saved in DB
  const settings = getSettings();
  try { camera.setIntegerFeature("StrobeEnable", 1); } catch { /* ignore */ }
  try { camera.setStringFeature("TriggerMode", "On"); } catch { /* ignore */ }
  const exposureAuto = settings.exposureAuto || "Off";
  const gainAuto = settings.gainAuto || "Off";
  try { camera.setStringFeature("GainAuto", gainAuto); } catch { /* ignore */ }
  try { camera.setStringFeature("ExposureAuto", exposureAuto); } catch { /* ignore */ }
  
  // Restore strobe
  try { camera.setBooleanFeature("StrobeEnable", true); } catch {
    try { camera.setIntegerFeature("StrobeEnable", 1); } catch { /* ignore */ }
  }
  
  if (camera.isFeatureAvailable("LineSelector")) {
    try { camera.setStringFeature("LineSelector", "Line1"); } catch { /* ignore */ }
    try { camera.setStringFeature("LineSource", "ExposureActive"); } catch { /* ignore */ }
  }

  if (gainAuto === "Off") {
    try { camera.setGain(Number(settings.cameraGain) || 0); } catch { /* ignore */ }
  }
  if (exposureAuto === "Off") {
    try { camera.setExposureTime(Number(settings.cameraExposure) || 5000); } catch { /* ignore */ }
  }

  // Restore configured frame rate
  if (settings.frameRate) {
    try {
      camera.setBooleanFeature("AcquisitionFrameRateEnable", true);
      camera.setFrameRate(Number(settings.frameRate));
    } catch { /* ignore */ }
  } else {
    try {
      camera.setBooleanFeature("AcquisitionFrameRateEnable", false);
    } catch { /* ignore */ }
  }

  try { stream.startAcquisition(); } catch { /* ignore */ }
}

export function setPixelFormat(format: string) {
  if (!camera || !isConnected) return;
  
  const wasAcquiring = !!stream;
  if (wasAcquiring) {
    try { stream!.stopAcquisition(); } catch { /* ignore */ }
  }

  if (format === "Color") {
    const fallbacks = ["BayerBG8", "BayerRG8", "BayerGR8", "BayerGB8", "RGB8Packed", "RGB8"];
    let success = false;
    for (const fmt of fallbacks) {
      try {
        camera.setStringFeature("PixelFormat", fmt);
        console.log(`[industrial-camera] Set PixelFormat to ${fmt}`);
        success = true;
        break;
      } catch { /* ignore */ }
    }
    if (!success) {
      console.error("[industrial-camera] Failed to set PixelFormat for Color. No formats accepted.");
    }
  } else {
    try {
      camera.setStringFeature("PixelFormat", "Mono8");
      console.log(`[industrial-camera] Set PixelFormat to Mono8`);
    } catch (e) {
      console.error("[industrial-camera] Failed to set PixelFormat to Mono8", e);
    }
  }

  if (wasAcquiring) {
    try { stream!.startAcquisition(); } catch { /* ignore */ }
  }
}

export function getPixelFormat(): string {
  if (!camera || !isConnected) return "Mono";
  try {
    const fmt = camera.getStringFeature("PixelFormat");
    return (fmt.startsWith("Bayer") || fmt.startsWith("RGB")) ? "Color" : "Mono";
  } catch {
    return "Mono";
  }
}

export function setStrobeDuration(value: number) {
  if (!camera || !isConnected) return;
  try {
    camera.setIntegerFeature("StrobeLineDuration", value);
  } catch (e) {
    console.error("Failed to set StrobeLineDuration", e);
  }
}

export function setCameraFeatureStr(feature: string, value: string) {
  if (!camera || !isConnected) return;
  try { camera.setStringFeature(feature, value); } catch (e) { console.error(`Failed to set ${feature}`, e); }
}

export function setCameraFeatureInt(feature: string, value: number) {
  if (!camera || !isConnected) return;
  try { camera.setIntegerFeature(feature, value); } catch (e) { console.error(`Failed to set ${feature}`, e); }
}
