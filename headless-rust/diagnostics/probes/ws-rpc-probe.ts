import type { DiagConfig } from "../config";

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
  private ws: WebSocket | null = null;
  private isRunning = false;
  private reqIdCounter = 1000;
  private pendingCalls = new Map<number, { record: RpcCallRecord; timeoutTimer: NodeJS.Timeout }>();
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timeoutTimer);
    }
    this.pendingCalls.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }

  public getStats(): WsRpcStats {
    const totalCalls = this.completedCalls.length + this.pendingCalls.size;
    const successfulCalls = this.completedCalls.filter((c) => !c.timedOut && !c.error).length;
    const timedOutCalls = this.completedCalls.filter((c) => c.timedOut).length;

    const successfulRtts = this.completedCalls
      .filter((c) => c.rttMs !== undefined && !c.timedOut)
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
      connected: this.ws !== null && this.ws.readyState === WebSocket.OPEN,
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
        const ws = new WebSocket(this.config.wsUrl);
        this.ws = ws;

        let resolved = false;
        const connectTimer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        }, 4000);

        ws.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(connectTimer);
            resolve(true);
          }
          if (this.onUpdateCallback) this.onUpdateCallback();
        };

        ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(connectTimer);
            resolve(false);
          }
        };

        ws.onclose = () => {
          this.disconnects++;
          if (this.isRunning) {
            // Auto reconnect after 1s
            setTimeout(() => {
              if (this.isRunning) void this.connect();
            }, 1000);
          }
          if (this.onUpdateCallback) this.onUpdateCallback();
        };
      } catch (_) {
        resolve(false);
      }
    });
  }

  private sendRpc(method: string, params: any): number {
    const id = ++this.reqIdCounter;
    const now = Date.now();

    const record: RpcCallRecord = {
      id,
      method,
      sentAt: now,
      timedOut: false,
    };

    // RPC timeout after 5000ms
    const timeoutTimer = setTimeout(() => {
      if (this.pendingCalls.has(id)) {
        const pending = this.pendingCalls.get(id)!;
        this.pendingCalls.delete(id);
        pending.record.timedOut = true;
        pending.record.rttMs = 5000;
        this.completedCalls.push(pending.record);
        if (this.onUpdateCallback) this.onUpdateCallback();
      }
    }, 5000);

    this.pendingCalls.set(id, { record, timeoutTimer });

    try {
      this.ws?.send(JSON.stringify({ id, method, params }));
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      this.pendingCalls.delete(id);
      record.error = err.message;
      this.completedCalls.push(record);
    }

    return id;
  }

  private handleMessage(data: any) {
    const now = Date.now();
    try {
      const msg = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString());

      // Case 1: RPC Response
      if (msg.id !== undefined && this.pendingCalls.has(msg.id)) {
        const pending = this.pendingCalls.get(msg.id)!;
        this.pendingCalls.delete(msg.id);
        clearTimeout(pending.timeoutTimer);

        pending.record.receivedAt = now;
        pending.record.rttMs = Math.max(0, now - pending.record.sentAt);
        if (msg.error) {
          pending.record.error = String(msg.error);
        }
        this.completedCalls.push(pending.record);
      }

      // Case 2: Server Push Event
      if (msg.event) {
        const delta = this.lastPushTimestamp > 0 ? now - this.lastPushTimestamp : 0;
        // If delta < 40ms and previous event had a gap > 1500ms, mark as burst!
        const isBurst = delta < 40 && this.pushEvents.length > 0 && (this.pushEvents[this.pushEvents.length - 1].deltaFromPrevMs > 1500);

        this.pushEvents.push({
          event: msg.event,
          timestamp: now,
          deltaFromPrevMs: delta,
          isBurst,
        });
        this.lastPushTimestamp = now;
      }
    } catch (_) {}

    if (this.onUpdateCallback) this.onUpdateCallback();
  }
}
