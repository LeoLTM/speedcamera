import type { ServerWebSocket } from "bun";
import type { SpeedcameraRPC } from "../shared/types";

export type RequestHandlers = {
  [K in keyof SpeedcameraRPC["bun"]["requests"]]: (
    params: SpeedcameraRPC["bun"]["requests"][K]["params"]
  ) => Promise<SpeedcameraRPC["bun"]["requests"][K]["response"]> | SpeedcameraRPC["bun"]["requests"][K]["response"];
};

export type PushMessages = SpeedcameraRPC["webview"]["messages"];

export class RpcServer {
  private sockets = new Set<ServerWebSocket<unknown>>();
  private handlers: RequestHandlers;

  constructor(handlers: RequestHandlers) {
    this.handlers = handlers;
  }

  public registerSocket(ws: ServerWebSocket<unknown>) {
    this.sockets.add(ws);
  }

  public unregisterSocket(ws: ServerWebSocket<unknown>) {
    this.sockets.delete(ws);
  }

  public async handleMessage(ws: ServerWebSocket<unknown>, message: string | Buffer) {
    let msgStr = typeof message === "string" ? message : message.toString("utf-8");
    let parsed: any;
    try {
      parsed = JSON.parse(msgStr);
    } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { id, method, params } = parsed;
    if (!id || !method) {
      return;
    }

    const handler = (this.handlers as any)[method];
    if (!handler) {
      ws.send(JSON.stringify({ id, error: `Method '${method}' not found` }));
      return;
    }

    try {
      const result = await handler(params ?? {});
      ws.send(JSON.stringify({ id, result: result !== undefined ? result : null }));
    } catch (err: any) {
      console.error(`[rpc] Error executing method '${method}':`, err);
      ws.send(JSON.stringify({ id, error: err?.message || String(err) }));
    }
  }

  public broadcast<K extends keyof PushMessages>(event: K, payload: PushMessages[K]) {
    const data = JSON.stringify({ event, payload });
    for (const ws of this.sockets) {
      try {
        ws.send(data);
      } catch (err) {
        console.error("[rpc] Failed to push to socket:", err);
      }
    }
  }
}
