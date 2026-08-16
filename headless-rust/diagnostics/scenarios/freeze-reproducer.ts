import type { DiagConfig } from "../config";
import type { SshClient } from "../ssh-client";
import { LatencyProbe } from "../probes/latency-probe";
import { WsRpcProbe } from "../probes/ws-rpc-probe";
import { PiKernelProbe } from "../probes/pi-kernel-probe";
import type { ScenarioResult } from "./baseline";
import { HttpProbe } from "../probes/http-probe";

export interface FreezeReproducerResult extends ScenarioResult {
  idleFreezeObserved: boolean;
  unclogTriggerSuccess: boolean;
  unclogRecoveryTimeMs: number;
  preBurstMaxLatencyMs: number;
  postBurstAvgLatencyMs: number;
  wifiPowerSaveActive: boolean;
}

export async function runFreezeReproducerScenario(
  config: DiagConfig,
  ssh: SshClient,
  onProgress?: (status: string) => void
): Promise<FreezeReproducerResult> {
  const log = (msg: string) => {
    if (onProgress) onProgress(msg);
  };

  log("[freeze-reproducer] Initializing Wi-Fi Hotspot Freeze & Unclog Reproducer...");

  const latencyProbe = new LatencyProbe({ ...config, pingIntervalMs: 100 });
  const wsProbe = new WsRpcProbe({ ...config, rpcIntervalMs: 1000 });
  const kernelProbe = new PiKernelProbe(config, ssh);
  const httpProbe = new HttpProbe(config);

  latencyProbe.start();
  await wsProbe.start();
  kernelProbe.start();

  // Phase 1: Establish baseline with minimal activity (5 seconds)
  log("[freeze-reproducer] [Phase 1/3] Measuring active link baseline (5s)...");
  await new Promise((r) => setTimeout(r, 5000));

  // Phase 2: Inactivity silence period to allow Wi-Fi AP or client power-save to engage (8 seconds)
  log("[freeze-reproducer] [Phase 2/3] Entering 8s idle period to observe Wi-Fi power-save sleep / freeze...");
  
  // Pause high-rate RPCs during idle phase to observe sleep
  const preBurstLatencies: number[] = [];
  const idleStartTime = Date.now();
  while (Date.now() - idleStartTime < 8000) {
    const samples = latencyProbe.getSamples();
    if (samples.length > 0) {
      const latest = samples[samples.length - 1];
      if (latest.rttMs !== null) {
        preBurstLatencies.push(latest.rttMs);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const preBurstMaxLatencyMs = preBurstLatencies.length > 0 ? Math.max(...preBurstLatencies) : 0;
  const idleFreezeObserved = preBurstMaxLatencyMs > 200 || preBurstLatencies.some((l) => l > 150);

  log(`[freeze-reproducer] Idle phase complete. Max latency during idle: ${preBurstMaxLatencyMs}ms (Freeze observed: ${idleFreezeObserved})`);

  // Phase 3: Trigger Unclog Burst (Simulate keystroke / packet spam)
  log("[freeze-reproducer] [Phase 3/3] Sending outbound packet burst to test 'pipe unclogging' effect...");
  const burstStart = performance.now();

  // Send 10 rapid SSH probes / TCP pings within 500ms
  const burstPromises = Array.from({ length: 8 }).map((_, i) =>
    ssh.exec(`echo "unclog-ping-${i}"`, 1500).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }))
  );

  await Promise.all(burstPromises);
  const burstDuration = performance.now() - burstStart;

  // Measure recovery
  log(`[freeze-reproducer] Burst dispatched in ${Math.round(burstDuration)}ms. Measuring recovery latency (5s)...`);
  await new Promise((r) => setTimeout(r, 5000));

  latencyProbe.stop();
  wsProbe.stop();
  kernelProbe.stop();

  const allSamples = latencyProbe.getSamples();
  const postBurstSamples = allSamples.slice(-40).filter((s) => s.rttMs !== null);
  const postBurstAvgLatencyMs = postBurstSamples.length > 0
    ? postBurstSamples.reduce((a, b) => a + b.rttMs!, 0) / postBurstSamples.length
    : 0;

  const unclogTriggerSuccess = preBurstMaxLatencyMs > 100 && postBurstAvgLatencyMs < 30;
  const unclogRecoveryTimeMs = Math.round(burstDuration);

  const kernelSnapshots = kernelProbe.getSnapshots();
  const latestKernel = kernelSnapshots.length > 0 ? kernelSnapshots[kernelSnapshots.length - 1] : null;
  const wifiPowerSaveActive = latestKernel?.wifi.power_save.toLowerCase() === "on";

  const anomaliesDetected: string[] = [];
  if (idleFreezeObserved) {
    anomaliesDetected.push(`Wi-Fi link latency degraded during idle periods (up to ${preBurstMaxLatencyMs}ms)`);
  }
  if (unclogTriggerSuccess) {
    anomaliesDetected.push(`Unclog confirmed: Outbound client traffic instantly restored low latency from ${preBurstMaxLatencyMs}ms down to ${Math.round(postBurstAvgLatencyMs)}ms`);
  }
  if (wifiPowerSaveActive) {
    anomaliesDetected.push("Wi-Fi interface power_save is active on the Pi");
  }

  log(`[freeze-reproducer] Result: Idle Freeze = ${idleFreezeObserved}, Unclog Response = ${unclogTriggerSuccess}, Recovery Avg = ${Math.round(postBurstAvgLatencyMs)}ms`);

  return {
    scenarioName: "Wi-Fi Hotspot Idle Freeze & Unclog Reproducer",
    durationSec: 18,
    latencyStats: latencyProbe.getStats(),
    wsStats: wsProbe.getStats(),
    httpStats: httpProbe.getStats(),
    kernelSnapshots,
    anomaliesDetected,
    idleFreezeObserved,
    unclogTriggerSuccess,
    unclogRecoveryTimeMs,
    preBurstMaxLatencyMs: Math.round(preBurstMaxLatencyMs * 10) / 10,
    postBurstAvgLatencyMs: Math.round(postBurstAvgLatencyMs * 10) / 10,
    wifiPowerSaveActive,
  };
}
