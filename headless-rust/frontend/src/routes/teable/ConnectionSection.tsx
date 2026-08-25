import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/stores/useAppStore";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  LinkSquare02Icon,
  Unlink04Icon,
  Loading03Icon,
  Alert01Icon,
} from "@hugeicons/core-free-icons";

export function ConnectionSection() {
  const teableConnected = useAppStore((s) => s.teableConnected);
  const teableUrl = useAppStore((s) => s.teableUrl);
  const teableUserName = useAppStore((s) => s.teableUserName);
  const teableUserEmail = useAppStore((s) => s.teableUserEmail);
  const teableUserAvatar = useAppStore((s) => s.teableUserAvatar);
  const isTeableLoading = useAppStore((s) => s.isTeableLoading);
  const connectTeable = useAppStore((s) => s.connectTeable);
  const disconnectTeable = useAppStore((s) => s.disconnectTeable);

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    const trimUrl = url.trim().replace(/\/+$/, "");
    const trimToken = token.trim();
    if (!trimUrl) { setError("Please enter the Teable instance URL."); return; }
    if (!trimToken) { setError("Please enter your Personal Access Token."); return; }
    try {
      await connectTeable(trimUrl, trimToken);
      setUrl("");
      setToken("");
      toast.success("Connected to Teable");
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDisconnect = async () => {
    await disconnectTeable();
    toast.success("Teable integration removed");
  };

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Connection
      </h2>

      {teableConnected ? (
        // ── Connected state ──────────────────────────────────────────────────
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-3">
            {teableUserAvatar ? (
              <img
                src={teableUserAvatar}
                alt={teableUserName}
                className="h-10 w-10 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-primary text-sm font-semibold">
                  {teableUserName.charAt(0).toUpperCase() || "T"}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{teableUserName || "Teable User"}</p>
              {teableUserEmail && (
                <p className="text-xs text-muted-foreground truncate">{teableUserEmail}</p>
              )}
              <p className="text-xs text-muted-foreground truncate">{teableUrl}</p>
            </div>
            <div className="ml-auto shrink-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                Connected
              </span>
            </div>
          </div>

          <Button
            variant="destructive"
            size="sm"
            className="gap-2"
            onClick={handleDisconnect}
            disabled={isTeableLoading}
          >
            {isTeableLoading ? (
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
            ) : (
              <HugeiconsIcon icon={Unlink04Icon} strokeWidth={2} className="h-4 w-4" />
            )}
            Remove Integration
          </Button>
        </div>
      ) : (
        // ── Disconnected state ───────────────────────────────────────────────
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="teable-url">Instance URL</Label>
            <Input
              id="teable-url"
              type="url"
              placeholder="https://teable.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isTeableLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="teable-token">Personal Access Token</Label>
            <Input
              id="teable-token"
              type="password"
              placeholder="teable_pat_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={isTeableLoading}
              onKeyDown={(e) => { if (e.key === "Enter") void handleConnect(); }}
            />
            <p className="text-xs text-muted-foreground">
              Create a token under{" "}
              <span className="font-medium">Settings → Personal Access Tokens</span> in your
              Teable instance.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={() => void handleConnect()}
            disabled={isTeableLoading}
            className="gap-2"
          >
            {isTeableLoading ? (
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
            ) : (
              <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="h-4 w-4" />
            )}
            {isTeableLoading ? "Connecting…" : "Test & Connect"}
          </Button>
        </div>
      )}
    </section>
  );
}
