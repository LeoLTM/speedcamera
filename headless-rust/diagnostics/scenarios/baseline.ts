import type { DiagConfig } from "../config";
import type { SshClient } from "../ssh-client";
import { LatencyProbe, type LatencyStats } from "../probes/latency-probe";
import { WsRpcProbe, type WsRpcStats } from "../probes/ws-rpc-probe";
import { PiKernelProbe, type PiKernelSnapshot } from "../probes/pi-kernel-probe";
import { HttpProbe, type HttpStats } from "../probes/http-probe";

export interface ScenarioResult {
  scenarioName: string;
  durationSec: number;
  latencyStats: LatencyStats;
  wsStats: WsRpcStats;
  httpStats: HttpStats;
  kernelSnapshots: PiKernelSnapshot[];
  anomaliesDetected: string[];
}

export async function runBaselineScenario(
  config: DiagConfig,
  ssh: SshClient,
  durationSec = config.durationSec,
  onProgress?: (status: string) => void
): Promise<ScenarioResult> {
  const log = (msg: string) => {
    if (onProgress) onProgress(msg);
  };

  log(`[baseline] Starting ${durationSec}s baseline stability test against ${config.host}...`);

  const latencyProbe = new LatencyProbe(config);
  const wsProbe = new WsRpcProbe(config);
  const kernelProbe = new PiKernelProbe(config, ssh);
  const httpProbe = new HttpProbe(config);

  latencyProbe.start();
  await wsProbe.start();
  kernelProbe.start();
  httpProbe.start(3000);

  // Monitor progress
  const startTime = Date.now();
  const endTime = startTime + durationSec * 1000;

  while (Date.now() < endTime) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, durationSec - elapsed);
    const lStats = latencyProbe.getStats();
    const wStats = wsProbe.getStats();
    log(`[baseline] ${elapsed}s / ${durationSec}s | Ping: ${lStats.avgRttMs}ms (max: ${lStats.maxRttMs}ms, loss: ${lStats.lossPercent.toFixed(1)}%) | WS RPCs: ${wStats.successfulCalls}/${wStats.totalCalls} (avg: ${wStats.avgRpcRttMs}ms)`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  latencyProbe.stop();
  wsProbe.stop();
  kernelProbe.stop();
  httpProbe.stop();

  const latencyStats = latencyProbe.getStats();
  const wsStats = wsProbe.getStats();
  const httpStats = httpProbe.getStats();
  const kernelSnapshots = kernelProbe.getSnapshots();

  // Detect basic anomalies
  const anomaliesDetected: string[] = [];
  if (latencyStats.lossPercent > 5) {
    anomaliesDetected.push(`High ICMP packet loss: ${latencyStats.lossPercent.toFixed(1)}%`);
  }
  if (latencyStats.maxRttMs > 300) {
    anomaliesDetected.push(`Severe ping latency spikes detected (max ${latencyStats.maxRttMs}ms)`);
  }
  if (wsStats.timedOutCalls > 0) {
    anomaliesDetected.push(`WebSocket RPC timeouts observed: ${wsStats.timedOutCalls} timed out calls`);
  }
  if (wsStats.burstEventsCount > 0) {
    anomaliesDetected.push(`Clustered event bursts detected (${wsStats.burstEventsCount} events delivered in burst after silence)`);
  }

  // Check kernel snapshots
  const latestKernel = kernelSnapshots.length > 0 ? kernelSnapshots[kernelSnapshots.length - 1] : null;
  if (latestKernel) {
    if (latestKernel.wifi.power_save.toLowerCase() === "on") {
      anomaliesDetected.push(`Pi Wi-Fi power save is ENABLED on ${latestKernel.wifi.interface}`);
    }
    if (latestKernel.wifi.inactive_time_ms > 2000) {
      anomaliesDetected.push(`Wi-Fi station inactive time is high (${latestKernel.wifi.inactive_time_ms}ms)`);
    }
    if (latestKernel.sysctl.rmem_default > 10485760 || latestKernel.sysctl.wmem_default > 10485760) {
      anomaliesDetected.push(`Kernel socket buffer defaults are excessively high (rmem_default: ${(latestKernel.sysctl.rmem_default / 1024 / 1024).toFixed(1)}MB, wmem_default: ${(latestKernel.sysctl.wmem_default / 1024 / 1024).toFixed(1)}MB)`);
    }
    if (latestKernel.memory.dirty_kb > 50000) {
      anomaliesDetected.push(`High dirty page memory: ${(latestKernel.memory.dirty_kb / 1024).toFixed(1)}MB`);
    }
  }

  return {
    scenarioName: "Baseline Network Stability",
    durationSec,
    latencyStats,
    wsStats,
    httpStats,
    kernelSnapshots,
    anomaliesDetected,
  };
}
