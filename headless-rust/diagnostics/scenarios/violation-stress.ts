import type { DiagConfig } from "../config";
import type { SshClient } from "../ssh-client";
import { LatencyProbe } from "../probes/latency-probe";
import { WsRpcProbe } from "../probes/ws-rpc-probe";
import { PiKernelProbe } from "../probes/pi-kernel-probe";
import { HttpProbe } from "../probes/http-probe";
import type { ScenarioResult } from "./baseline";

export interface ViolationStressResult extends ScenarioResult {
  maxDirtyMemoryKb: number;
  dStateProcessCount: number;
  coincidentRpcTimeouts: number;
  diskIoStallDetected: boolean;
}

export async function runViolationStressScenario(
  config: DiagConfig,
  ssh: SshClient,
  onProgress?: (status: string) => void
): Promise<ViolationStressResult> {
  const log = (msg: string) => {
    if (onProgress) onProgress(msg);
  };

  log("[violation-stress] Testing correlation between image capture / storage writeback and network stalls...");

  const latencyProbe = new LatencyProbe({ ...config, pingIntervalMs: 80 });
  const wsProbe = new WsRpcProbe({ ...config, rpcIntervalMs: 250 });
  const kernelProbe = new PiKernelProbe(config, ssh);
  const httpProbe = new HttpProbe(config);

  latencyProbe.start();
  await wsProbe.start();
  kernelProbe.start();

  log("[violation-stress] Generating synthetic image capture writes (5 x 5MB bursts) on Pi storage...");

  // Generate 5 rapid violation capture bursts on Pi disk to stress I/O writeback & sqlite
  const stressCmd = `
    TMP_DIR=$(mktemp -d /tmp/speedcam-stress-XXXXXX)
    for i in {1..5}; do
      dd if=/dev/urandom of="$TMP_DIR/img_$i.jpg" bs=1M count=5 2>/dev/null
      sync
      sleep 0.4
    done
    rm -rf "$TMP_DIR"
  `;

  // Start background write stress
  const stressPromise = ssh.exec(stressCmd, 15000);

  // Monitor while stress is running
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const lStats = latencyProbe.getStats();
    const wStats = wsProbe.getStats();
    log(`[violation-stress] Latency: ${lStats.avgRttMs}ms (max: ${lStats.maxRttMs}ms) | WS RPC timeouts: ${wStats.timedOutCalls}`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  await stressPromise.catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));

  latencyProbe.stop();
  wsProbe.stop();
  kernelProbe.stop();

  const latencyStats = latencyProbe.getStats();
  const wsStats = wsProbe.getStats();
  const httpStats = httpProbe.getStats();
  const kernelSnapshots = kernelProbe.getSnapshots();

  const maxDirtyMemoryKb = kernelSnapshots.length > 0
    ? Math.max(...kernelSnapshots.map((k) => k.memory.dirty_kb))
    : 0;

  const dStateProcessCount = kernelSnapshots.length > 0
    ? Math.max(...kernelSnapshots.map((k) => k.memory.d_state_processes))
    : 0;

  const diskIoStallDetected = (latencyStats.maxRttMs > 300 || wsStats.timedOutCalls > 0) && maxDirtyMemoryKb > 20000;

  const anomaliesDetected: string[] = [];
  if (diskIoStallDetected) {
    anomaliesDetected.push(`Storage writeback coincides with network stall: Dirty memory peaked at ${(maxDirtyMemoryKb / 1024).toFixed(1)}MB with ${wsStats.timedOutCalls} RPC timeouts`);
  }
  if (dStateProcessCount > 0) {
    anomaliesDetected.push(`D-state (uninterruptible disk sleep) processes observed during disk sync: ${dStateProcessCount}`);
  }

  return {
    scenarioName: "Image Capture & Storage Writeback Stress",
    durationSec: 10,
    latencyStats,
    wsStats,
    httpStats,
    kernelSnapshots,
    anomaliesDetected,
    maxDirtyMemoryKb,
    dStateProcessCount,
    coincidentRpcTimeouts: wsStats.timedOutCalls,
    diskIoStallDetected,
  };
}
