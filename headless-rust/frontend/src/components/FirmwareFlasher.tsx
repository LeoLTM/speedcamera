import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DownloadCircle02Icon,
  RefreshIcon,
  Cancel01Icon,
  CpuIcon,
  Alert02Icon,
  ViewIcon,
  ViewOffSlashIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import type { GithubRelease } from "@/shared/types";

export function FirmwareFlasher() {
  const isFlashing = useAppStore((s) => s.isFlashing);
  const flashProgressLines = useAppStore((s) => s.flashProgressLines);
  const flashError = useAppStore((s) => s.flashError);
  const flashDone = useAppStore((s) => s.flashDone);
  const resetFlash = useAppStore((s) => s.resetFlash);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const setConnectedPort = useAppStore((s) => s.setConnectedPort);

  // ── Token state ────────────────────────────────────────────────────────────
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testingToken, setTestingToken] = useState(false);
  const [tokenTestResult, setTokenTestResult] = useState<
    { valid: boolean; login?: string; error?: string } | null
  >(null);

  // ── Release state ──────────────────────────────────────────────────────────
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("");

  const logRef = useRef<HTMLPreElement>(null);

  // Load saved token on mount
  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((s) => setToken(s.githubToken))
      .catch(() => {});
  }, []);

  // Auto-scroll progress log
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [flashProgressLines]);

  // Toast on completion / error
  useEffect(() => {
    if (flashDone) {
      toast.success("Firmware flashed successfully. Reconnect the device manually.");
    }
  }, [flashDone]);

  useEffect(() => {
    if (flashError) {
      toast.error(`Flash failed: ${flashError}`);
    }
  }, [flashError]);

  // ── Token handlers ─────────────────────────────────────────────────────────

  const handleTokenChange = (value: string) => {
    setToken(value);
    setTokenTestResult(null);
  };

  const handleTokenBlur = () => {
    getRpc()
      .request.saveSetting({ key: "githubToken", value: token })
      .catch(() => toast.error("Failed to save token"));
  };

  const handleTestToken = async () => {
    setTestingToken(true);
    setTokenTestResult(null);
    try {
      const result = await getRpc().request.testGithubToken({ token });
      setTokenTestResult(result);
      if (result.valid) {
        toast.success(`Connected as ${result.login ?? "unknown"}`);
      } else {
        toast.error(result.error ?? "Connection test failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenTestResult({ valid: false, error: msg });
    } finally {
      setTestingToken(false);
    }
  };

  // ── Release handlers ───────────────────────────────────────────────────────

  const fetchReleases = useCallback(async () => {
    setLoadingReleases(true);
    try {
      const data = await getRpc().request.listFirmwareReleases({});
      setReleases(data);
      if (data.length > 0 && !selectedTag) {
        setSelectedTag(data[0].tag);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("authentication") ? msg : "Failed to fetch firmware releases");
    } finally {
      setLoadingReleases(false);
    }
  }, [selectedTag]);

  useEffect(() => {
    void fetchReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFlash = async () => {
    if (!selectedTag) return;
    resetFlash();

    const selectedRelease = releases.find((r) => r.tag === selectedTag);
    if (!selectedRelease?.firmwareAssetApiUrl) {
      toast.error(
        "No firmware.bin asset found for this release. Make sure the release includes a firmware.bin file.",
      );
      return;
    }

    const portToFlash =
      connectedPort ||
      (await getRpc()
        .request.listPorts({})
        .then(
          (p) =>
            p.find((x) => /\/dev\/(ttyUSB|ttyACM)|COM\d|cu\.usb|tty\.usb/i.test(x.path))?.path ??
            "",
        )
        .catch(() => ""));

    if (!portToFlash) {
      toast.error("No serial port found. Connect the device and try again.");
      return;
    }

    try {
      await getRpc().request.flashFirmware({
        releaseTag: selectedTag,
        port: portToFlash,
        firmwareAssetApiUrl: selectedRelease.firmwareAssetApiUrl,
      });
      setConnectedPort("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Flash failed: ${msg}`);
    }
  };

  const handleCancel = async () => {
    try {
      await getRpc().request.cancelFlash({});
    } catch {
      // ignore
    }
    resetFlash();
  };

  const showLog = flashProgressLines.length > 0 || isFlashing;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <HugeiconsIcon icon={CpuIcon} size={16} strokeWidth={2} />
        Firmware Update
      </h2>

      {/* ── GitHub token config ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">GitHub Access Token</p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              onBlur={handleTokenBlur}
              placeholder="github_pat_…"
              className="pr-9 font-mono text-xs"
              disabled={isFlashing}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              <HugeiconsIcon
                icon={showToken ? ViewOffSlashIcon : ViewIcon}
                size={14}
                strokeWidth={2}
              />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestToken}
            disabled={testingToken || isFlashing || !token.trim()}
          >
            {testingToken ? "Testing…" : "Test"}
          </Button>
        </div>

        {/* Test result feedback */}
        {tokenTestResult && (
          <p
            className={`text-xs flex items-center gap-1 font-medium ${
              tokenTestResult.valid
                ? "text-green-600 dark:text-green-400"
                : "text-destructive"
            }`}
          >
            {tokenTestResult.valid ? (
              <>
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
                Connected as {tokenTestResult.login ?? "GitHub user"}
              </>
            ) : (
              <>
                <HugeiconsIcon icon={Alert02Icon} size={12} strokeWidth={2} />
                {tokenTestResult.error}
              </>
            )}
          </p>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">
          A fine-grained PAT with &quot;Contents: Read&quot; access to the speedcamera repository is
          required to fetch and download firmware releases from the private repo.
        </p>
      </div>

      {/* ── Release selector ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedTag}
          onValueChange={setSelectedTag}
          disabled={isFlashing || loadingReleases}
        >
          <SelectTrigger className="flex-1">
            <SelectValue
              placeholder={loadingReleases ? "Loading releases…" : "Select a release…"}
            />
          </SelectTrigger>
          <SelectContent>
            {releases.length === 0 ? (
              <SelectItem value="__none" disabled>
                {loadingReleases ? "Loading…" : "No releases found"}
              </SelectItem>
            ) : (
              releases.map((r) => (
                <SelectItem key={r.tag} value={r.tag}>
                  {r.tag}
                  {r.prerelease ? " (canary)" : ""}
                  {" — "}
                  {new Date(r.publishedAt).toLocaleDateString()}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          onClick={fetchReleases}
          disabled={loadingReleases || isFlashing}
          aria-label="Refresh releases"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            strokeWidth={2}
            className={loadingReleases ? "animate-spin" : ""}
          />
        </Button>
      </div>

      {/* Info note */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        The serial connection will be closed automatically before flashing. Reconnect manually after
        the update completes.
      </p>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleFlash}
          disabled={isFlashing || !selectedTag || selectedTag === "__none"}
        >
          <HugeiconsIcon
            icon={DownloadCircle02Icon}
            strokeWidth={2}
            className={isFlashing ? "animate-pulse" : ""}
          />
          {isFlashing ? "Flashing…" : "Flash Firmware"}
        </Button>

        {isFlashing && (
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            Cancel
          </Button>
        )}

        {(flashDone || flashError) && !isFlashing && (
          <Button variant="ghost" size="sm" onClick={resetFlash}>
            Clear
          </Button>
        )}
      </div>

      {/* Status badge */}
      {flashDone && !isFlashing && (
        <p className="text-xs text-green-600 dark:text-green-400 font-medium">
          Flash complete — device is rebooting.
        </p>
      )}
      {flashError && !isFlashing && (
        <p className="text-xs text-destructive flex items-center gap-1 font-medium">
          <HugeiconsIcon icon={Alert02Icon} size={12} strokeWidth={2} />
          {flashError}
        </p>
      )}

      {/* Progress log */}
      {showLog && (
        <pre
          ref={logRef}
          className="max-h-48 overflow-y-auto rounded-md border bg-muted p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all"
        >
          {flashProgressLines.join("\n")}
          {isFlashing && <span className="animate-pulse">▋</span>}
        </pre>
      )}
    </section>
  );
}
