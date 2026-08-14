import type { SpeedcameraRPC } from "@/shared/types";
import { useAppStore } from "@/stores/useAppStore";

type RequestMap = SpeedcameraRPC["bun"]["requests"];
type PushMessageMap = SpeedcameraRPC["webview"]["messages"];

export type SpeedcameraClientRPC = {
  request: {
    [K in keyof RequestMap]: (
      params: RequestMap[K]["params"]
    ) => Promise<RequestMap[K]["response"]>;
  };
};

class WebSocketRpcClient {
  private ws: WebSocket | null = null;
  private reqIdCounter = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  constructor() {
    this.connect();
  }

  private getWebSocketUrl(): string {
    if (typeof window === "undefined") return "ws://127.0.0.1:3000/ws/rpc";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // includes port (e.g. localhost:5173 or 192.168.4.1:3000)
    return `${protocol}//${host}/ws/rpc`;
  }

  private connect() {
    if (typeof window === "undefined" || this.isConnecting) return;
    this.isConnecting = true;

    try {
      const url = this.getWebSocketUrl();
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        console.log("[rpc-client] Connected to speedcamera daemon");
        this.isConnecting = false;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Case 1: Response to a pending request
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
        console.warn("[rpc-client] WebSocket error:", err);
      };

      ws.onclose = () => {
        console.log("[rpc-client] Disconnected. Reconnecting in 2s...");
        this.isConnecting = false;
        this.ws = null;
        if (!this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
          }, 2000);
        }
      };
    } catch (err) {
      this.isConnecting = false;
      console.error("[rpc-client] Connection failed:", err);
    }
  }

  private handlePushEvent<K extends keyof PushMessageMap>(event: K, payload: PushMessageMap[K]) {
    const store = useAppStore.getState();
    switch (event) {
      case "serialStatus":
        store.handleSerialStatus(payload as any);
        break;
      case "flashProgress":
        store.handleFlashProgress(payload as any);
        break;
      case "cameraStatus":
        store.setCameraStatus(payload as any);
        break;
      case "liveFrame":
        store.setLiveFrame(payload as any);
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

      this.pendingRequests.set(id, { resolve, reject, timer });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id, method, params }));
      } else {
        // If websocket not ready yet, wait briefly or connect
        const checkInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            this.ws.send(JSON.stringify({ id, method, params }));
          }
        }, 100);

        // Cancel retry if request times out
        setTimeout(() => clearInterval(checkInterval), 9500);
      }
    });
  }
}

const client = new WebSocketRpcClient();

// Proxy accessor so `getRpc().request.someMethod(params)` works transparently
const rpcProxy: SpeedcameraClientRPC = {
  request: new Proxy({} as any, {
    get(_target, prop: string) {
      return (params: any = {}) => client.call(prop, params);
    },
  }),
};

export function getRpc(): SpeedcameraClientRPC {
  return rpcProxy;
}
