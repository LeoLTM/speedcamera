import type { DiagConfig } from "../config";
import { io, Socket } from "socket.io-client";

export interface RpcCallRecord {
  id: number;
  method: string;
  sentAt: number;
  receivedAt?: number;
  rttMs?: number;
  timedOut: boolean;
  error?: string;
}

export interface PushEventRecord {
  event: string;
  timestamp: number;
  deltaFromPrevMs: number;
  isBurst: boolean; // true if arrived in a clustered burst after a stall
}

export interface WsRpcStats {
  connected: boolean;
  connectAttempts: number;
  disconnects: number;
  totalCalls: number;
  successfulCalls: number;
  timedOutCalls: number;
  avgRpcRttMs: number;
  maxRpcRttMs: number;
  minRpcRttMs: number;
  pushEventsCount: number;
  burstEventsCount: number; // Events arriving in rapid bursts (>3 events in <50ms after >1.5s silence)
  eventBreakdown: Record<string, number>;
}

export class WsRpcProbe {
  private config: DiagConfig;
  private socket: Socket | null = null;
  private isRunning = false;
  private reqIdCounter = 1000;
  private completedCalls: RpcCallRecord[] = [];
  private pushEvents: PushEventRecord[] = [];
  private lastPushTimestamp = 0;
  private connectAttempts = 0;
  private disconnects = 0;
  private loopTimer: NodeJS.Timeout | null = null;
  private onUpdateCallback?: () => void;

  constructor(config: DiagConfig) {
    this.config = config;
  }

  public onUpdate(cb: () => void) {
    this.onUpdateCallback = cb;
  }

  public async start(): Promise<boolean> {
    if (this.isRunning) return true;
    this.isRunning = true;
    this.completedCalls = [];
    this.pushEvents = [];
    this.lastPushTimestamp = Date.now();

    const connected = await this.connect();

    // Start periodic RPC call loop
    const interval = Math.max(200, this.config.rpcIntervalMs);
    const rpcMethods = ["getSettings", "getCameraStatus", "getViolations"];
    let methodIdx = 0;

    const rpcLoop = async () => {
      if (!this.isRunning) return;
      if (this.socket && this.socket.connected) {
        const method = rpcMethods[methodIdx % rpcMethods.length];
        methodIdx++;
        const params = method === "getViolations" ? { page: 1, limit: 5 } : {};
        this.sendRpc(method, params);
      }
      if (this.isRunning) {
        this.loopTimer = setTimeout(rpcLoop, interval);
      }
    };

    rpcLoop();
    return connected;
  }

  public stop() {
    this.isRunning = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (_) {}
      this.socket = null;
    }
  }

  public getStats(): WsRpcStats {
    const totalCalls = this.completedCalls.length;
    const successfulCalls = this.completedCalls.filter((c) => !c.timedOut && !c.error).length;
    const timedOutCalls = this.completedCalls.filter((c) => c.timedOut).length;

    const successfulRtts = this.completedCalls
      .filter((c) => c.rttMs !== undefined && !c.timedOut && !c.error)
      .map((c) => c.rttMs!);

    const avgRpcRttMs = successfulRtts.length > 0 ? successfulRtts.reduce((a, b) => a + b, 0) / successfulRtts.length : 0;
    const maxRpcRttMs = successfulRtts.length > 0 ? Math.max(...successfulRtts) : 0;
    const minRpcRttMs = successfulRtts.length > 0 ? Math.min(...successfulRtts) : 0;

    const eventBreakdown: Record<string, number> = {};
    for (const evt of this.pushEvents) {
      eventBreakdown[evt.event] = (eventBreakdown[evt.event] || 0) + 1;
    }

    const burstEventsCount = this.pushEvents.filter((e) => e.isBurst).length;

    return {
      connected: this.socket !== null && this.socket.connected,
      connectAttempts: this.connectAttempts,
      disconnects: this.disconnects,
      totalCalls,
      successfulCalls,
      timedOutCalls,
      avgRpcRttMs: Math.round(avgRpcRttMs * 10) / 10,
      maxRpcRttMs: Math.round(maxRpcRttMs * 10) / 10,
      minRpcRttMs: Math.round(minRpcRttMs * 10) / 10,
      pushEventsCount: this.pushEvents.length,
      burstEventsCount,
      eventBreakdown,
    };
  }

  public getCompletedCalls(): RpcCallRecord[] {
    return [...this.completedCalls];
  }

  public getPushEvents(): PushEventRecord[] {
    return [...this.pushEvents];
  }

  private connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.connectAttempts++;
      try {
        const socket = io(this.config.httpUrl, {
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          timeout: 4000,
        });
        this.socket = socket;

        let resolved = false;
        const connectTimer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        }, 4000);

        socket.on("connect", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(connectTimer);
            resolve(true);
          }
          if (this.onUpdateCallback) this.onUpdateCallback();
        });

        const recordPush = (event: string) => {
          const now = Date.now();
          const delta = this.lastPushTimestamp > 0 ? now - this.lastPushTimestamp : 0;
          const isBurst = delta < 40 && this.pushEvents.length > 0 && (this.pushEvents[this.pushEvents.length - 1].deltaFromPrevMs > 1500);

          this.pushEvents.push({
            event,
            timestamp: now,
            deltaFromPrevMs: delta,
            isBurst,
          });
          this.lastPushTimestamp = now;
          if (this.onUpdateCallback) this.onUpdateCallback();
        };

        socket.on("cameraStatus", () => recordPush("cameraStatus"));
        socket.on("serialStatus", () => recordPush("serialStatus"));
        socket.on("liveFrame", () => recordPush("liveFrame"));
        socket.on("violation", () => recordPush("violation"));
        socket.on("flashProgress", () => recordPush("flashProgress"));
        socket.on("armedStatus", () => recordPush("armedStatus"));

        socket.on("connect_error", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(connectTimer);
            resolve(false);
          }
        });

        socket.on("disconnect", () => {
          this.disconnects++;
          if (this.onUpdateCallback) this.onUpdateCallback();
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  private async sendRpc(method: string, params: any) {
    const id = ++this.reqIdCounter;
    const now = Date.now();

    const record: RpcCallRecord = {
      id,
      method,
      sentAt: now,
      timedOut: false,
    };

    if (!this.socket || !this.socket.connected) {
      record.error = "Not connected";
      this.completedCalls.push(record);
      if (this.onUpdateCallback) this.onUpdateCallback();
      return;
    }

    try {
      const resp: any = await this.socket.timeout(5000).emitWithAck("rpc", { method, params });
      const recAt = Date.now();
      record.receivedAt = recAt;
      record.rttMs = Math.max(0, recAt - now);
      if (resp && resp.error) {
        record.error = resp.error;
      }
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.message?.includes("timeout")) {
        record.timedOut = true;
        record.rttMs = 5000;
      } else {
        record.error = err.message;
      }
    }

    this.completedCalls.push(record);
    if (this.onUpdateCallback) this.onUpdateCallback();
  }
}
