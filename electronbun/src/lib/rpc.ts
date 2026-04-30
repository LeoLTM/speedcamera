import { Electroview } from "electrobun/view";
import { toast } from "sonner";
import type { SpeedcameraRPC } from "@/shared/types";
import { useAppStore } from "@/stores/useAppStore";

// Electroview<T> requires T to extend RPCWithTransport (the internal RPC wire type),
// NOT the schema description (SpeedcameraRPC). We extract the correct internal type
// via an instantiation expression from defineRPC, then cast the singleton .rpc
// accessor to that type so callers get full type-safe request/send access.
type SpeedcameraInternalRPC = ReturnType<typeof Electroview.defineRPC<SpeedcameraRPC>>;

// Initialize synchronously at module load so getRpc() is always available,
// regardless of React effect scheduling order.
const _rpc = Electroview.defineRPC<SpeedcameraRPC>({
  handlers: {
    requests: {},
    messages: {
      // Use getState() so we don't depend on the React lifecycle for setup.
      serialStatus: (payload) => useAppStore.getState().handleSerialStatus(payload),
      updateAvailable: ({ version }) => {
        toast.info(`Update available: v${version}`, {
          duration: Infinity,
          action: {
            label: "Restart to update",
            onClick: () => void getRpc().request.applyUpdate({}),
          },
        });
      },
    },
  },
});

const _electroview = new Electroview({ rpc: _rpc });

/** Returns the typed RPC accessor for calling bun-side request handlers. */
export function getRpc(): SpeedcameraInternalRPC {
  return _electroview.rpc as SpeedcameraInternalRPC;
}
