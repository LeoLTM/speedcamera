import { useEffect, useRef } from "react";
import { rpcClient } from "@/lib/rpc";
import type { SpeedcameraRPC } from "@/shared/types";

type PushMessageMap = SpeedcameraRPC["webview"]["messages"];

/**
 * Reusable hook to subscribe to backend WebSocket broadcast events
 * with automatic unbind / cleanup on unmount.
 *
 * @param event The event name to subscribe to
 * @param handler Callback invoked whenever the backend emits the event
 */
export function useBackendEvent<K extends keyof PushMessageMap | "connectionChange">(
  event: K,
  handler: (payload: K extends keyof PushMessageMap ? PushMessageMap[K] : boolean) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsubscribe = rpcClient.on(event, (payload) => {
      handlerRef.current(payload);
    });

    return () => {
      unsubscribe();
    };
  }, [event]);
}
