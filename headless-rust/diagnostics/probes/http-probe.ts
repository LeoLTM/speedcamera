import type { DiagConfig } from "../config";

export interface HttpSample {
  url: string;
  status: number | null;
  ttfbMs: number | null;
  totalMs: number | null;
  error?: string;
  timestamp: number;
}

export interface HttpStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgTtfbMs: number;
  maxTtfbMs: number;
  minTtfbMs: number;
}

export class HttpProbe {
  private config: DiagConfig;
  private isRunning = false;
  private samples: HttpSample[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(config: DiagConfig) {
    this.config = config;
  }

  public async measureEndpoint(path = "/"): Promise<HttpSample> {
    const url = `${this.config.httpUrl}${path}`;
    const start = performance.now();
    const timestamp = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(url, { signal: controller.signal });
      const ttfb = performance.now() - start;
      await res.text();
      const total = performance.now() - start;
      clearTimeout(timeout);

      const sample: HttpSample = {
        url,
        status: res.status,
        ttfbMs: Math.round(ttfb * 10) / 10,
        totalMs: Math.round(total * 10) / 10,
        timestamp,
      };
      this.samples.push(sample);
      return sample;
    } catch (err: any) {
      const sample: HttpSample = {
        url,
        status: null,
        ttfbMs: null,
        totalMs: null,
        error: err.name === "AbortError" ? "Timed out (4000ms)" : err.message,
        timestamp,
      };
      this.samples.push(sample);
      return sample;
    }
  }

  public start(intervalMs = 2000) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.samples = [];

    const poll = async () => {
      if (!this.isRunning) return;
      await this.measureEndpoint("/");
      if (this.isRunning) {
        this.timer = setTimeout(poll, intervalMs);
      }
    };

    poll();
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getStats(): HttpStats {
    const totalRequests = this.samples.length;
    const successful = this.samples.filter((s) => s.status !== null && s.status >= 200 && s.status < 400);
    const failedRequests = totalRequests - successful.length;

    const ttfbs = successful.map((s) => s.ttfbMs!).filter((t) => t !== null);
    const avgTtfbMs = ttfbs.length > 0 ? ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length : 0;
    const maxTtfbMs = ttfbs.length > 0 ? Math.max(...ttfbs) : 0;
    const minTtfbMs = ttfbs.length > 0 ? Math.min(...ttfbs) : 0;

    return {
      totalRequests,
      successfulRequests: successful.length,
      failedRequests,
      avgTtfbMs: Math.round(avgTtfbMs * 10) / 10,
      maxTtfbMs: Math.round(maxTtfbMs * 10) / 10,
      minTtfbMs: Math.round(minTtfbMs * 10) / 10,
    };
  }

  public getSamples(): HttpSample[] {
    return [...this.samples];
  }
}
