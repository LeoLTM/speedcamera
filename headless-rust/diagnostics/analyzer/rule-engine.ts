import type { ScenarioResult } from "../scenarios/baseline";
import type { FreezeReproducerResult } from "../scenarios/freeze-reproducer";
import type { ViolationStressResult } from "../scenarios/violation-stress";
import type { GigeContentionResult } from "../scenarios/gige-wifi-contention";

export interface DiagnosticFinding {
  id: string;
  title: string;
  category: "WIFI_LINK" | "BUFFERBLOAT" | "STORAGE_IO" | "CPU_IRQ" | "APP_RUNTIME";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  confidenceScore: number; // 0 to 100
  summary: string;
  empiricalEvidence: string[];
  remediation: {
    description: string;
    commands: string[];
    automatedFixScript?: string;
  };
}

export interface AnalysisSummary {
  overallHealth: "HEALTHY" | "DEGRADED" | "CRITICAL";
  primaryRootCause?: DiagnosticFinding;
  findings: DiagnosticFinding[];
}

export function evaluateDiagnosticFindings(results: {
  baseline?: ScenarioResult;
  freeze?: FreezeReproducerResult;
  violation?: ViolationStressResult;
  gige?: GigeContentionResult;
}): AnalysisSummary {
  const findings: DiagnosticFinding[] = [];

  // ===========================================================================
  // RULE 1: Wi-Fi Power-Save & 802.11 Inactivity Stall (Keystroke Unclog Effect)
  // ===========================================================================
  let wifiPsConfidence = 0;
  const wifiPsEvidence: string[] = [];

  if (results.freeze?.unclogTriggerSuccess) {
    wifiPsConfidence += 45;
    wifiPsEvidence.push(
      `Outbound burst immediately unclogged latency from ${results.freeze.preBurstMaxLatencyMs}ms to ${results.freeze.postBurstAvgLatencyMs}ms`
    );
  }
  if (results.freeze?.idleFreezeObserved) {
    wifiPsConfidence += 30;
    wifiPsEvidence.push(
      `Link latency spiked to ${results.freeze.preBurstMaxLatencyMs}ms specifically during idle periods`
    );
  }
  if (results.freeze?.wifiPowerSaveActive) {
    wifiPsConfidence += 25;
    wifiPsEvidence.push("Wi-Fi power_save is reported ON in the Pi kernel");
  }

  // Also check baseline push event clustering
  if ((results.baseline?.wsStats.burstEventsCount || 0) > 0) {
    wifiPsConfidence += 15;
    wifiPsEvidence.push(
      `${results.baseline?.wsStats.burstEventsCount} WebSocket push events arrived in rapid bursts after idle gaps`
    );
  }

  wifiPsConfidence = Math.min(100, wifiPsConfidence);

  if (wifiPsConfidence >= 30) {
    findings.push({
      id: "WIFI_POWER_SAVE_AP_STALL",
      title: "Wi-Fi AP / Client 802.11 Power-Save Sleep & Frame Aggregation Queue Stall",
      category: "WIFI_LINK",
      severity: wifiPsConfidence >= 70 ? "CRITICAL" : "HIGH",
      confidenceScore: wifiPsConfidence,
      summary:
        "The Pi Wi-Fi driver (brcmfmac) or client 802.11 power management puts the Wi-Fi radio or transmission queue into sleep state during inactivity. Outbound traffic (such as typing in SSH or sending requests) immediately wakes up the queue and flushes buffered frames.",
      empiricalEvidence: wifiPsEvidence,
      remediation: {
        description:
          "Disable Wi-Fi power saving permanently, configure hostapd / nmcli DTIM period to 1, and disable brcmfmac TxGlom/P2P sleep options.",
        commands: [
          "# 1. Force Wi-Fi power save off immediately on Pi",
          "sudo iw dev wlan0 set power_save off",
          "# 2. Disable brcmfmac driver power management module parameters",
          "sudo bash -c 'echo \"options brcmfmac feature_disable=0x82000\" > /etc/modprobe.d/brcmfmac.conf'",
          "# 3. Optimize NetworkManager Wi-Fi AP settings to 5GHz band a, channel 36",
          "sudo nmcli connection modify 'Speedcamera-Hotspot' 802-11-wireless.powersave 2 802-11-wireless.band a 802-11-wireless.channel 36",
          "# 4. Permanently disable Wi-Fi power save via systemd service",
          "sudo systemctl enable --now wifi-power-off.service",
        ],
      },
    });
  }

  // ===========================================================================
  // RULE 2: Global Socket Buffer Defaults (67MB) Bufferbloat on Wi-Fi
  // ===========================================================================
  let bufferConfidence = 0;
  const bufferEvidence: string[] = [];

  const latestKernel = results.baseline?.kernelSnapshots[results.baseline.kernelSnapshots.length - 1];
  const rmemDefault = latestKernel?.sysctl.rmem_default || 0;
  const wmemDefault = latestKernel?.sysctl.wmem_default || 0;

  if (rmemDefault > 10485760 || wmemDefault > 10485760) {
    bufferConfidence += 60;
    bufferEvidence.push(
      `net.core.rmem_default (${(rmemDefault / 1024 / 1024).toFixed(1)}MB) and wmem_default (${(wmemDefault / 1024 / 1024).toFixed(1)}MB) are set globally to GigE extreme sizes`
    );
  }
  if ((results.baseline?.wsStats.timedOutCalls || 0) > 0 && (results.baseline?.latencyStats.lossPercent || 0) < 5) {
    bufferConfidence += 30;
    bufferEvidence.push(
      `WebSocket RPCs timed out after 5s while basic ICMP ping packets succeeded with low loss (${results.baseline?.latencyStats.lossPercent.toFixed(1)}%)`
    );
  }

  bufferConfidence = Math.min(100, bufferConfidence);

  if (bufferConfidence >= 40) {
    findings.push({
      id: "GIGE_SYSCTL_BUFFERBLOAT",
      title: "Global Socket Buffer Defaults (67MB) Inducing Severe Wi-Fi TCP Bufferbloat",
      category: "BUFFERBLOAT",
      severity: "HIGH",
      confidenceScore: bufferConfidence,
      summary:
        "Setting net.core.rmem_default and wmem_default to 67MB affects EVERY TCP socket on the Pi (including WebSocket, HTTP, and SSH). When Wi-Fi packet drops occur, massive un-flushed TCP send buffers and inflated congestion windows cause 10-second TCP head-of-line blocking.",
      empiricalEvidence: bufferEvidence,
      remediation: {
        description:
          "Keep GigE camera buffer maximums (rmem_max / wmem_max = 128MB) so camera capture sockets can allocate large buffers explicitly via SO_RCVBUF, restore default socket buffer sizes (rmem_default / wmem_default = 262KB) for general TCP/Wi-Fi sockets, and enable fq_codel smart queueing.",
        commands: [
          "# Restore sensible default socket buffers while keeping max limits for GigE camera and enable fq_codel",
          "sudo bash -c 'cat > /etc/sysctl.d/60-gige-camera.conf <<EOF",
          "net.core.rmem_max = 134217728",
          "net.core.wmem_max = 134217728",
          "net.core.rmem_default = 262144",
          "net.core.wmem_default = 262144",
          "net.ipv4.tcp_rmem = 4096 131072 67108864",
          "net.ipv4.tcp_wmem = 4096 65536 67108864",
          "net.core.netdev_max_backlog = 30000",
          "net.core.default_qdisc = fq_codel",
          "vm.dirty_background_ratio = 5",
          "vm.dirty_ratio = 10",
          "EOF'",
          "sudo sysctl --system",
        ],
      },
    });
  }

  // ===========================================================================
  // RULE 3: Storage Dirty-Page Writeback Freeze during Picture Capture
  // ===========================================================================
  let storageConfidence = 0;
  const storageEvidence: string[] = [];

  if (results.violation?.diskIoStallDetected) {
    storageConfidence += 50;
    storageEvidence.push(
      `Disk I/O burst caused ping/WS latency spike with ${(results.violation.maxDirtyMemoryKb / 1024).toFixed(1)}MB dirty memory`
    );
  }
  if ((results.violation?.dStateProcessCount || 0) > 0) {
    storageConfidence += 30;
    storageEvidence.push(
      `${results.violation?.dStateProcessCount} processes entered D-state (uninterruptible disk sleep) during capture sync`
    );
  }

  storageConfidence = Math.min(100, storageConfidence);

  if (storageConfidence >= 30) {
    findings.push({
      id: "STORAGE_WRITEBACK_STALL",
      title: "Storage Writeback / Dirty Page Flush Freeze during Image Save",
      category: "STORAGE_IO",
      severity: storageConfidence >= 70 ? "HIGH" : "MEDIUM",
      confidenceScore: storageConfidence,
      summary:
        "When an image is saved to SD card or slow storage, the Linux kernel dirty page ratio triggers synchronous writeback flushes, blocking I/O threads and kernel memory allocation for network buffers.",
      empiricalEvidence: storageEvidence,
      remediation: {
        description:
          "Tune Linux virtual memory dirty background ratios to force small, smooth background flushes instead of giant blocking sync bursts.",
        commands: [
          "# Lower dirty ratio to trigger early background flushes and prevent large I/O blocking spikes",
          "sudo bash -c 'cat > /etc/sysctl.d/70-dirty-writeback.conf <<EOF",
          "vm.dirty_background_ratio = 5",
          "vm.dirty_ratio = 10",
          "vm.dirty_expire_centisecs = 500",
          "vm.dirty_writeback_centisecs = 100",
          "EOF'",
          "sudo sysctl --system",
        ],
      },
    });
  }

  // ===========================================================================
  // RULE 4: GigE Vision Ethernet vs Wi-Fi SoftIRQ Contention
  // ===========================================================================
  if (results.gige?.coreImbalanceDetected) {
    findings.push({
      id: "SOFTIRQ_CORE_CONTENTION",
      title: "Network SoftIRQ Clustered on Single CPU Core",
      category: "CPU_IRQ",
      severity: "MEDIUM",
      confidenceScore: 60,
      summary:
        "High packet rates from GigE Vision Ethernet (eth0) and Wi-Fi AP (wlan0) are both servicing softirqs on the same CPU core, leading to Wi-Fi packet drops during camera capture bursts.",
      empiricalEvidence: [
        `NET_RX softirq distribution across cores: ${JSON.stringify(results.gige.netRxSoftirqPerCpu)}`,
      ],
      remediation: {
        description:
          "Enable Receive Packet Steering (RPS) on eth0 and wlan0 to distribute network interrupts across all 4 Pi 5 CPU cores.",
        commands: [
          "# Distribute Ethernet and Wi-Fi packet processing across all CPU cores (CPU 0-3 mask: f)",
          "sudo bash -c 'echo f > /sys/class/net/eth0/queues/rx-0/rps_cpus 2>/dev/null || echo f > /sys/class/net/end0/queues/rx-0/rps_cpus 2>/dev/null || true'",
          "sudo bash -c 'echo f > /sys/class/net/wlan0/queues/rx-0/rps_cpus 2>/dev/null || true'",
        ],
      },
    });
  }

  // Sort findings by confidence and severity
  findings.sort((a, b) => b.confidenceScore - a.confidenceScore);

  let overallHealth: "HEALTHY" | "DEGRADED" | "CRITICAL" = "HEALTHY";
  if (findings.some((f) => f.severity === "CRITICAL")) {
    overallHealth = "CRITICAL";
  } else if (findings.some((f) => f.severity === "HIGH" || f.severity === "MEDIUM")) {
    overallHealth = "DEGRADED";
  }

  return {
    overallHealth,
    primaryRootCause: findings[0],
    findings,
  };
}
