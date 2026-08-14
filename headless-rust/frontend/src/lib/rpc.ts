import type { SpeedcameraRPC, Violation, SerialStatusPayload, CameraStatusPayload, FlashProgressPayload } from "@/shared/types";
import { useAppStore } from "@/stores/useAppStore";
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

class WebSocketRpcClient {
  private ws: WebSocket | null = null;
  private reqIdCounter = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
    }
  >();
  private messageQueue: string[] = [];
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 500;
  private maxReconnectDelay = 5000;
  private isConnecting = false;
  private isExplicitlyClosed = false;

  private listeners = new Map<string, Set<EventCallback>>();

  constructor() {
    this.connect();
  }

  private getWebSocketUrl(): string {
    if (typeof window === "undefined") return "ws://127.0.0.1:3000/ws/rpc";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // includes port (e.g. localhost:5173 or 192.168.4.1:3000)
    return `${protocol}//${host}/ws/rpc`;
  }

  public connect() {
    if (typeof window === "undefined" || this.isConnecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.isConnecting = true;

    try {
      const url = this.getWebSocketUrl();
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        console.log("[rpc-client] Connected to speedcamera daemon");
        this.isConnecting = false;
        this.reconnectDelay = 500;
        this.emit("connectionChange", true);

        // Flush any queued messages
        while (this.messageQueue.length > 0) {
          const queued = this.messageQueue.shift();
          if (queued && ws.readyState === WebSocket.OPEN) {
            ws.send(queued);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Case 1: Response to a pending RPC request
          if (data.id !== undefined && this.pendingRequests.has(data.id)) {
            const pending = this.pendingRequests.get(data.id)!;
            this.pendingRequests.delete(data.id);
            clearTimeout(pending.timer);

            if (data.error) {
              pending.reject(new Error(data.error));
            } else {
              pending.resolve(data.result);
            }
            return;
          }

          // Case 2: Server push broadcast event
          if (data.event) {
            this.handlePushEvent(data.event as keyof PushMessageMap, data.payload);
            return;
          }
        } catch (err) {
          console.error("[rpc-client] Error handling message:", err);
        }
      };

      ws.onerror = (err) => {
        console.warn("[rpc-client] WebSocket transport error:", err);
        this.isConnecting = false;
      };

      ws.onclose = (event) => {
        console.log(`[rpc-client] Disconnected (code: ${event.code}). Reconnecting in ${this.reconnectDelay}ms...`);
        this.isConnecting = false;
        this.ws = null;
        this.emit("connectionChange", false);

        if (!this.isExplicitlyClosed && !this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
            this.connect();
          }, this.reconnectDelay);
        }
      };
    } catch (err) {
      this.isConnecting = false;
      console.error("[rpc-client] Failed to create WebSocket connection:", err);
      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
        }, this.reconnectDelay);
      }
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
    this.emit(event, payload);
  }

  public call(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.reqIdCounter;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC request '${method}' timed out after 10000ms`));
        }
      }, 10000);

      this.pendingRequests.set(id, { resolve, reject, timer, method });
      const payloadStr = JSON.stringify({ id, method, params });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(payloadStr);
      } else {
        // Queue message and ensure connection is active
        this.messageQueue.push(payloadStr);
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          this.connect();
        }
      }
    });
  }
}

export const rpcClient = new WebSocketRpcClient();

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

