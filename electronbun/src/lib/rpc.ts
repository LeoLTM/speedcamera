import { Electroview } from "electrobun/view";
import type { SpeedcameraRPC, SerialStatusPayload } from "@/shared/types";

// Electroview<T> requires T to extend RPCWithTransport (the internal RPC wire type),
// NOT the schema description (SpeedcameraRPC). We extract the correct internal type
// via an instantiation expression from defineRPC, then cast the singleton .rpc
// accessor to that type so callers get full type-safe request/send access.
const _defineRpcTyped = Electroview.defineRPC<SpeedcameraRPC>;
type SpeedcameraInternalRPC = ReturnType<typeof _defineRpcTyped>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _electroview: Electroview<any> | null = null;

export function initElectroview(onSerialStatus: (payload: SerialStatusPayload) => void): void {
  const rpc = Electroview.defineRPC<SpeedcameraRPC>({
    handlers: {
      requests: {},
      messages: {
        serialStatus: (payload) => onSerialStatus(payload),
      },
    },
  });
  _electroview = new Electroview({ rpc });
}

/** Returns the typed RPC accessor for calling bun-side request handlers. */
export function getRpc(): SpeedcameraInternalRPC {
  if (!_electroview) {
    throw new Error("Electroview not initialized. Call initElectroview() first.");
  }
  return _electroview.rpc as SpeedcameraInternalRPC;
}
