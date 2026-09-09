import type { SpeedcameraRPC, Violation, SerialStatusPayload, CameraStatusPayload, FlashProgressPayload } from "@/shared/types";
import { useAppStore } from "@/stores/useAppStore";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";

type RequestMap = SpeedcameraRPC["bun"]["requests"];
type PushMessageMap = SpeedcameraRPC["webview"]["messages"];

export type SpeedcameraClientRPC = {
  request: {
    [K in keyof RequestMap]: (
      params: RequestMap[K]["params"]
    ) => Promise<RequestMap[K]["response"]>;
  };
};

type EventCallback<T = any> = (payload: T) => void;

class SocketIoRpcClient {
  private socket: Socket;
  private listeners = new Map<string, Set<EventCallback>>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private isProbing = false;

  constructor() {
    const socketUrl = this.getSocketUrl();
    this.socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.2,
      timeout: 20000,
      autoConnect: true,
    });

    this.setupListeners();
    this.setupLifecycleListeners();
  }

  private getSocketUrl(): string {
    if (typeof window === "undefined") return "http://127.0.0.1:3000";
    return window.location.origin;
  }

  private setupListeners() {
    this.socket.on("connect", () => {
      console.log(`[rpc-client] Socket.io connected (id: ${this.socket.id}, transport: ${this.socket.io.engine?.transport?.name})`);
      this.missedHeartbeats = 0;
      this.emit("connectionChange", true);
      this.startHeartbeat();

      // Resync state on connection / reconnection
      const store = useAppStore.getState();
      void store.refreshCameraStatus?.();
      void store.refreshSerialStatus?.();
      void store.refreshArmedStatus?.();
      void store.refreshOperatingMode?.();
    });


    this.socket.on("disconnect", (reason) => {
      console.log(`[rpc-client] Socket.io disconnected (reason: ${reason})`);
      this.stopHeartbeat();
      this.emit("connectionChange", false);
      this.emit("heartbeat" as any, { connected: false, latencyMs: null, degraded: true });

      // If disconnected by transport close or server disconnect, proactively attempt reconnect
      if (reason === "io server disconnect" || reason === "transport close") {
        this.socket.connect();
      }
    });

    this.socket.on("connect_error", (err) => {
      console.warn("[rpc-client] Socket.io connection error:", err.message);
    });

    // Server push events
    this.socket.on("serialStatus", (payload: SerialStatusPayload) => {
      this.handlePushEvent("serialStatus", payload);
    });

    this.socket.on("cameraStatus", (payload: CameraStatusPayload) => {
      this.handlePushEvent("cameraStatus", payload);
    });

    this.socket.on("liveFrame", (payload: string) => {
      this.handlePushEvent("liveFrame", payload);
    });

    this.socket.on("violation", (payload: Violation) => {
      this.handlePushEvent("violation", payload);
    });

    this.socket.on("flashProgress", (payload: FlashProgressPayload) => {
      this.handlePushEvent("flashProgress", payload);
    });

    this.socket.on("armedStatus", (payload: { armed: boolean }) => {
      this.handlePushEvent("armedStatus", payload);
    });

    this.socket.on("operatingMode", (payload: any) => {
      this.handlePushEvent("operatingMode", payload);
    });

    this.socket.on("operatingModeChanged", (payload: any) => {
      this.handlePushEvent("operatingModeChanged", payload);
    });
  }


  /**
   * Monitor browser lifecycle events (tab switching, screen sleep/wake, Wi-Fi reconnect)
   * to immediately wake and verify the socket instead of waiting for OS TCP timeouts.
   */
  private setupLifecycleListeners() {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    // 1. Tab visibility / device wake
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        console.log("[rpc-client] Tab became active — verifying connection liveness");
        if (!this.socket.connected) {
          this.socket.connect();
        } else {
          void this.probeAndRecover();
        }
      }
    });

    // 2. Network adapter online event (Wi-Fi reconnected)
    window.addEventListener("online", () => {
      console.log("[rpc-client] Wi-Fi / network online event triggered");
      if (!this.socket.connected) {
        this.socket.connect();
      } else {
        void this.probeAndRecover();
      }
    });

    // 3. Window focus
    window.addEventListener("focus", () => {
      if (!this.socket.connected) {
        this.socket.connect();
      }
    });

    // 4. Back-forward cache restore
    window.addEventListener("pageshow", () => {
      if (!this.socket.connected) {
        this.socket.connect();
      }
    });
  }

  private async probeAndRecover() {
    if (this.isProbing) return;
    this.isProbing = true;
    try {
      if (!this.socket.connected) {
        this.socket.connect();
        return;
      }
      await this.socket.timeout(5000).emitWithAck("ping");
      this.missedHeartbeats = 0;
    } catch (_) {
      console.warn("[rpc-client] Zombie connection detected during wake probe — resetting socket");
      this.socket.disconnect().connect();
    } finally {
      this.isProbing = false;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // 2000ms active heartbeat with 5s timeout:
    // 1. Sends continuous micro-packets to prevent 802.11 Wi-Fi DTIM sleep
    // 2. Real-time RTT latency telemetry
    // 3. Resilient tolerance (4 missed heartbeats) to prevent disconnect storms during Wi-Fi jitter
    this.heartbeatInterval = setInterval(async () => {
      if (!this.socket.connected) return;
      const start = performance.now();
      try {
        await this.socket.timeout(5000).emitWithAck("ping");
        const rtt = Math.round(performance.now() - start);
        this.missedHeartbeats = 0;
        this.emit("heartbeat" as any, { connected: true, latencyMs: rtt, degraded: rtt > 250 });
      } catch (_) {
        this.missedHeartbeats++;
        if (this.missedHeartbeats >= 4) {
          this.emit("heartbeat" as any, { connected: false, latencyMs: null, degraded: true });
          console.warn("[rpc-client] Missed 4 heartbeats (Wi-Fi queue stall) — resetting socket transport");
          this.socket.disconnect().connect();
        }
      }
    }, 2000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public on<K extends keyof PushMessageMap | "connectionChange">(
    event: K,
    callback: EventCallback<K extends keyof PushMessageMap ? PushMessageMap[K] : boolean>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unbind function for clean useEffect hook integration
    return () => {
      this.off(event, callback);
    };
  }

  public off<K extends keyof PushMessageMap | "connectionChange">(
    event: K,
    callback: EventCallback<K extends keyof PushMessageMap ? PushMessageMap[K] : boolean>
  ) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  private emit<K extends keyof PushMessageMap | "connectionChange">(
    event: K,
    payload: K extends keyof PushMessageMap ? PushMessageMap[K] : boolean
  ) {
    const set = this.listeners.get(event);
    if (set) {
      for (const callback of set) {
        try {
          callback(payload);
        } catch (err) {
          console.error(`[rpc-client] Error in listener for '${String(event)}':`, err);
        }
      }
    }
  }

  private handlePushEvent<K extends keyof PushMessageMap>(event: K, payload: PushMessageMap[K]) {
    // 1. Notify global Zustand store
    const store = useAppStore.getState();
    switch (event) {
      case "serialStatus": {
        const serialPayload = payload as SerialStatusPayload;
        if (serialPayload?.status === "CONNECTED") {
          const port = serialPayload.port || store.selectedPort || "connected";
          store.setConnectedPort(port);
          if (serialPayload.port) store.setSelectedPort(serialPayload.port);
        } else if (serialPayload?.status === "DISCONNECTED") {
          store.setConnectedPort("");
        }
        store.handleSerialStatus(serialPayload);
        break;
      }
      case "cameraStatus": {
        const camPayload = payload as CameraStatusPayload;
        store.setCameraStatus(camPayload);
        break;
      }
      case "liveFrame":
        store.setLiveFrame(payload as string);
        break;
      case "violation": {
        const violationPayload = payload as Violation;
        store.setLastViolation(violationPayload);
        toast.error(
          `⚡ Violation recorded: ${violationPayload.measuredSpeed} km/h (Limit: ${violationPayload.maxSpeed} km/h)`,
          {
            description: `Captured at ${new Date(violationPayload.timestamp).toLocaleTimeString()}`,
            duration: 4000,
          }
        );
        break;
      }
      case "flashProgress":
        store.handleFlashProgress(payload as FlashProgressPayload);
        break;
      case "armedStatus": {
        const armedPayload = payload as { armed: boolean };
        store.handleArmedStatus(armedPayload.armed);
        break;
      }
      case "operatingMode":
      case "operatingModeChanged": {
        const modePayload = payload as any;
        store.handleOperatingModeStatus?.(modePayload);
        break;
      }
      case "updateAvailable":

        store.setUpdateVersion((payload as any).version);
        store.setUpdatePhase("ready");
        break;
      case "updateProgress":
        store.handleUpdateProgress(payload as any);
        break;
      default:
        break;
    }

    // 2. Dispatch to custom pub-sub event listeners
    this.emit(event as any, payload as any);
  }

  public async call(method: string, params: any): Promise<any> {
    try {
      const response: any = await this.socket.timeout(10000).emitWithAck("rpc", { method, params });
      if (response && response.error) {
        throw new Error(response.error);
      }
      return response?.result;
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.message?.includes("timeout")) {
        throw new Error(`RPC request '${method}' timed out after 10000ms`);
      }
      throw err;
    }
  }

  public getRawSocket(): Socket {
    return this.socket;
  }
}

export const rpcClient = new SocketIoRpcClient();

// Proxy accessor so `getRpc().request.someMethod(params)` works transparently
const rpcProxy: SpeedcameraClientRPC = {
  request: new Proxy({} as any, {
    get(_target, prop: string) {
      return (params: any = {}) => rpcClient.call(prop, params);
    },
  }),
};

export function getRpc(): SpeedcameraClientRPC {
  return rpcProxy;
}
