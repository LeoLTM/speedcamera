import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagConfig } from "../config";
import type { SshClient } from "../ssh-client";

export interface PiKernelSnapshot {
  timestamp: number;
  wifi: {
    interface: string;
    power_save: string;
    client_mac: string;
    inactive_time_ms: number;
    signal_dbm: number;
    tx_retries: number;
    tx_failed: number;
    tx_bitrate: string;
    rx_bitrate: string;
    authorized: string;
    authenticated: string;
  };
  sysctl: {
    rmem_default: number;
    wmem_default: number;
    rmem_max: number;
    wmem_max: number;
    tcp_congestion_control: string;
    netdev_max_backlog: number;
  };
  memory: {
    dirty_kb: number;
    writeback_kb: number;
    available_kb: number;
    total_kb: number;
    d_state_processes: number;
  };
  hardware: {
    temp_c: string;
    throttled_hex: string;
    arm_freq_mhz: number;
  };
  softirqs: {
    net_rx_per_cpu: number[];
  };
  service: {
    pid: number;
    cpu_percent: string;
    rss_kb: number;
  };
  tcp_sockets: Array<{
    state: string;
    recv_q: number;
    send_q: number;
    local: string;
    peer: string;
    info: string;
  }>;
  dmesg_snippet: string;
}

export class PiKernelProbe {
  private config: DiagConfig;
  private ssh: SshClient;
  private scriptContent: string;
  private isRunning = false;
  private snapshots: PiKernelSnapshot[] = [];
  private timer: NodeJS.Timeout | null = null;
  private onSnapshotCallback?: (snapshot: PiKernelSnapshot) => void;

  constructor(config: DiagConfig, ssh: SshClient) {
    this.config = config;
    this.ssh = ssh;
    try {
      this.scriptContent = readFileSync(join(__dirname, "../pi-probe.sh"), "utf-8");
    } catch (_) {
      this.scriptContent = "";
    }
  }

  public onSnapshot(cb: (snapshot: PiKernelSnapshot) => void) {
    this.onSnapshotCallback = cb;
  }

  public async fetchSingleSnapshot(): Promise<PiKernelSnapshot | null> {
    if (!this.scriptContent) {
      try {
        this.scriptContent = readFileSync(join(__dirname, "../pi-probe.sh"), "utf-8");
      } catch (_) {}
    }

    const res = await this.ssh.execScript(this.scriptContent, 4000);
    if (res.exitCode === 0 && res.stdout) {
      try {
        const trimmed = res.stdout.trim();
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonStr = trimmed.substring(firstBrace, lastBrace + 1);
          return JSON.parse(jsonStr) as PiKernelSnapshot;
        }
      } catch (_) {}
    }
    return null;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.snapshots = [];

    const interval = Math.max(500, this.config.kernelProbeIntervalMs);

    const pollNext = async () => {
      if (!this.isRunning) return;
      const snapshot = await this.fetchSingleSnapshot();
      if (snapshot) {
        this.snapshots.push(snapshot);
        if (this.onSnapshotCallback) {
          this.onSnapshotCallback(snapshot);
        }
      }
      if (this.isRunning) {
        this.timer = setTimeout(pollNext, interval);
      }
    };

    pollNext();
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getSnapshots(): PiKernelSnapshot[] {
    return [...this.snapshots];
  }

  public getLatest(): PiKernelSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }
}
