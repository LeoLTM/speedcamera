import type { DiagConfig } from "../config";
import type { SshClient } from "../ssh-client";
import { LatencyProbe } from "../probes/latency-probe";
import { WsRpcProbe } from "../probes/ws-rpc-probe";
import { PiKernelProbe } from "../probes/pi-kernel-probe";
import { HttpProbe } from "../probes/http-probe";
import type { ScenarioResult } from "./baseline";

export interface GigeContentionResult extends ScenarioResult {
  coreImbalanceDetected: boolean;
  netRxSoftirqPerCpu: number[];
  bufferBloatObserved: boolean;
}

export async function runGigeContentionScenario(
  config: DiagConfig,
  ssh: SshClient,
  onProgress?: (status: string) => void
): Promise<GigeContentionResult> {
  const log = (msg: string) => {
    if (onProgress) onProgress(msg);
  };

  log("[gige-wifi-contention] Testing GigE Ethernet vs Wi-Fi SoftIRQ core balance & socket buffer bloat...");

  const latencyProbe = new LatencyProbe(config);
  const wsProbe = new WsRpcProbe(config);
  const kernelProbe = new PiKernelProbe(config, ssh);
  const httpProbe = new HttpProbe(config);

  latencyProbe.start();
  await wsProbe.start();
  kernelProbe.start();

  // Let it collect data for 6 seconds
  await new Promise((r) => setTimeout(r, 6000));

  latencyProbe.stop();
  wsProbe.stop();
  kernelProbe.stop();

  const latencyStats = latencyProbe.getStats();
  const wsStats = wsProbe.getStats();
  const httpStats = httpProbe.getStats();
  const kernelSnapshots = kernelProbe.getSnapshots();

  const latestKernel = kernelSnapshots.length > 0 ? kernelSnapshots[kernelSnapshots.length - 1] : null;
  const netRx = latestKernel?.softirqs.net_rx_per_cpu || [];

  // Check if one CPU core has >80% of all NET_RX softirqs
  let coreImbalanceDetected = false;
  const totalNetRx = netRx.reduce((a, b) => a + b, 0);
  if (totalNetRx > 0 && netRx.length > 1) {
    const maxCoreNetRx = Math.max(...netRx);
    if (maxCoreNetRx / totalNetRx > 0.8) {
      coreImbalanceDetected = true;
    }
  }

  // Check if buffer defaults are set to GigE extreme 67MB
  const bufferBloatObserved = (latestKernel?.sysctl.rmem_default || 0) > 10485760;

  const anomaliesDetected: string[] = [];
  if (coreImbalanceDetected) {
    anomaliesDetected.push(`NET_RX softirqs are heavily clustered on a single CPU core (${JSON.stringify(netRx)})`);
  }
  if (bufferBloatObserved) {
    anomaliesDetected.push(`GigE socket buffer defaults (67MB) are active globally on all sockets (causing TCP window bufferbloat on Wi-Fi)`);
  }

  return {
    scenarioName: "GigE Ethernet vs Wi-Fi Contention",
    durationSec: 6,
    latencyStats,
    wsStats,
    httpStats,
    kernelSnapshots,
    anomaliesDetected,
    coreImbalanceDetected,
    netRxSoftirqPerCpu: netRx,
    bufferBloatObserved,
  };
}
