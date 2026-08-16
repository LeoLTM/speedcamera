import { spawn } from "node:child_process";
import type { DiagConfig } from "../config";

export interface LatencySample {
  timestamp: number;
  rttMs: number | null; // null if lost / timeout
  seq: number;
}

export interface LatencyStats {
  samplesCount: number;
  transmitted: number;
  received: number;
  lossPercent: number;
  minRttMs: number;
  maxRttMs: number;
  avgRttMs: number;
  jitterMs: number;
  stallCount: number; // Count of samples with RTT > 300ms or dropped
  longestStallDurationMs: number;
}

export class LatencyProbe {
  private config: DiagConfig;
  private isRunning = false;
  private samples: LatencySample[] = [];
  private seqCounter = 0;
  private timer: NodeJS.Timeout | null = null;
  private onSampleCallback?: (sample: LatencySample) => void;

  constructor(config: DiagConfig) {
    this.config = config;
  }

  public onSample(cb: (sample: LatencySample) => void) {
    this.onSampleCallback = cb;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.samples = [];
    this.seqCounter = 0;

    const interval = Math.max(50, this.config.pingIntervalMs);

    const pingNext = async () => {
      if (!this.isRunning) return;
      const seq = ++this.seqCounter;
      const sample = await this.measureSinglePing(seq);
      this.samples.push(sample);
      if (this.onSampleCallback) {
        this.onSampleCallback(sample);
      }
      if (this.isRunning) {
        this.timer = setTimeout(pingNext, interval);
      }
    };

    pingNext();
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getSamples(): LatencySample[] {
    return [...this.samples];
  }

  public getStats(): LatencyStats {
    const transmitted = this.samples.length;
    const receivedSamples = this.samples.filter((s) => s.rttMs !== null);
    const received = receivedSamples.length;
    const lossPercent = transmitted > 0 ? ((transmitted - received) / transmitted) * 100 : 0;

    if (received === 0) {
      return {
        samplesCount: transmitted,
        transmitted,
        received: 0,
        lossPercent: 100,
        minRttMs: 0,
        maxRttMs: 0,
        avgRttMs: 0,
        jitterMs: 0,
        stallCount: transmitted,
        longestStallDurationMs: transmitted * this.config.pingIntervalMs,
      };
    }

    const rtts = receivedSamples.map((s) => s.rttMs!);
    const minRttMs = Math.min(...rtts);
    const maxRttMs = Math.max(...rtts);
    const avgRttMs = rtts.reduce((a, b) => a + b, 0) / rtts.length;

    // Calculate jitter (mean deviation between consecutive packets)
    let jitterSum = 0;
    let jitterPairs = 0;
    for (let i = 1; i < receivedSamples.length; i++) {
      jitterSum += Math.abs(receivedSamples[i].rttMs! - receivedSamples[i - 1].rttMs!);
      jitterPairs++;
    }
    const jitterMs = jitterPairs > 0 ? jitterSum / jitterPairs : 0;

    // Detect stall episodes (>250ms or loss)
    let stallCount = 0;
    let maxStallMs = 0;
    let currentStallMs = 0;

    for (const sample of this.samples) {
      if (sample.rttMs === null || sample.rttMs > 250) {
        stallCount++;
        currentStallMs += (sample.rttMs ?? this.config.pingIntervalMs);
        if (currentStallMs > maxStallMs) maxStallMs = currentStallMs;
      } else {
        currentStallMs = 0;
      }
    }

    return {
      samplesCount: transmitted,
      transmitted,
      received,
      lossPercent,
      minRttMs: Math.round(minRttMs * 100) / 100,
      maxRttMs: Math.round(maxRttMs * 100) / 100,
      avgRttMs: Math.round(avgRttMs * 100) / 100,
      jitterMs: Math.round(jitterMs * 100) / 100,
      stallCount,
      longestStallDurationMs: Math.round(maxStallMs),
    };
  }

  private measureSinglePing(seq: number): Promise<LatencySample> {
    return new Promise((resolve) => {
      const start = performance.now();
      const child = spawn("ping", ["-c", "1", "-W", "1", this.config.host], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ timestamp: Date.now(), rttMs: null, seq });
      }, 1200);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          // Parse time=X.XX ms
          const match = stdout.match(/time=([0-9.]+)\s*ms/);
          if (match) {
            const rtt = parseFloat(match[1]);
            resolve({ timestamp: Date.now(), rttMs: rtt, seq });
            return;
          }
          const fallbackRtt = performance.now() - start;
          resolve({ timestamp: Date.now(), rttMs: fallbackRtt, seq });
        } else {
          resolve({ timestamp: Date.now(), rttMs: null, seq });
        }
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve({ timestamp: Date.now(), rttMs: null, seq });
      });
    });
  }
}
