import { useState, useEffect } from "react";
import { createRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";
import type { TeableSpace, TeableBase, TeableTable } from "@/shared/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  LinkSquare02Icon,
  Unlink04Icon,
  RefreshIcon,
  Loading03Icon,
  CheckmarkCircle02Icon,
  Alert01Icon,
  SaveIcon,
  PlusSignSquareIcon,
} from "@hugeicons/core-free-icons";

export const TeableRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/teable",
  component: TeablePage,
});

// ─── Page shell ───────────────────────────────────────────────────────────────

function TeablePage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-xl font-semibold">Teable Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sync lap times to a self-hosted Teable instance.
          </p>
        </div>
        <ConnectionSection />
        <TableTargetSection />
        <SyncToggleSection />
      </div>
    </div>
  );
}

// ─── Section 1: Connection ────────────────────────────────────────────────────

function ConnectionSection() {
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

// ─── Section 2: Table target ──────────────────────────────────────────────────

function TableTargetSection() {
  const teableConnected = useAppStore((s) => s.teableConnected);
  const teableSpaceId = useAppStore((s) => s.teableSpaceId);
  const teableBaseId = useAppStore((s) => s.teableBaseId);
  const teableTableId = useAppStore((s) => s.teableTableId);
  const teableSchemaStatus = useAppStore((s) => s.teableSchemaStatus);
  const teableMissingFields = useAppStore((s) => s.teableMissingFields);
  const isTeableLoading = useAppStore((s) => s.isTeableLoading);
  const saveTeableTableTarget = useAppStore((s) => s.saveTeableTableTarget);
  const verifyTeableSchema = useAppStore((s) => s.verifyTeableSchema);
  const patchTeableSchema = useAppStore((s) => s.patchTeableSchema);
  const createAndSelectTable = useAppStore((s) => s.createAndSelectTable);

  const [spaces, setSpaces] = useState<TeableSpace[]>([]);
  const [bases, setBases] = useState<TeableBase[]>([]);
  const [tables, setTables] = useState<TeableTable[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);

  const [selectedSpaceId, setSelectedSpaceId] = useState(teableSpaceId);
  const [selectedBaseId, setSelectedBaseId] = useState(teableBaseId);
  const [selectedTableId, setSelectedTableId] = useState(teableTableId);

  const [newTableName, setNewTableName] = useState("");
  const [showNewTableForm, setShowNewTableForm] = useState(false);

  // Sync from store when connection changes
  useEffect(() => {
    setSelectedSpaceId(teableSpaceId);
    setSelectedBaseId(teableBaseId);
    setSelectedTableId(teableTableId);
  }, [teableSpaceId, teableBaseId, teableTableId]);

  // Load spaces when connected
  useEffect(() => {
    if (!teableConnected) { setSpaces([]); return; }
    setLoadingSpaces(true);
    getRpc().request.listTeableSpaces({})
      .then(setSpaces)
      .catch((e) => toast.error(`Failed to load spaces: ${String(e)}`))
      .finally(() => setLoadingSpaces(false));
  }, [teableConnected]);

  // Load bases when space selected
  useEffect(() => {
    setBases([]);
    if (!selectedSpaceId) return;
    setLoadingBases(true);
    getRpc().request.listTeableBases({ spaceId: selectedSpaceId })
      .then(setBases)
      .catch((e) => toast.error(`Failed to load bases: ${String(e)}`))
      .finally(() => setLoadingBases(false));
  }, [selectedSpaceId]);

  // Load tables when base selected
  useEffect(() => {
    setTables([]);
    if (!selectedBaseId) return;
    setLoadingTables(true);
    getRpc().request.listTeableTables({ baseId: selectedBaseId })
      .then(setTables)
      .catch((e) => toast.error(`Failed to load tables: ${String(e)}`))
      .finally(() => setLoadingTables(false));
  }, [selectedBaseId]);

  const handleSpaceChange = (id: string) => {
    setSelectedSpaceId(id);
    setSelectedBaseId("");
    setSelectedTableId("");
  };

  const handleBaseChange = (id: string) => {
    setSelectedBaseId(id);
    setSelectedTableId("");
  };

  const handleTableChange = (id: string) => {
    setSelectedTableId(id);
  };

  const hasChanges =
    selectedSpaceId !== teableSpaceId ||
    selectedBaseId !== teableBaseId ||
    selectedTableId !== teableTableId;

  const canSave = hasChanges && selectedSpaceId && selectedBaseId && selectedTableId;

  const handleSave = async () => {
    if (!canSave) return;
    await saveTeableTableTarget(selectedSpaceId, selectedBaseId, selectedTableId);
    await verifyTeableSchema(selectedTableId);
    toast.success("Table target saved");
  };

  const handleCreateTable = async () => {
    const name = newTableName.trim();
    if (!name) { toast.error("Please enter a table name."); return; }
    await createAndSelectTable(selectedBaseId, name);
    setNewTableName("");
    setShowNewTableForm(false);
    // Refresh tables list
    setLoadingTables(true);
    getRpc().request.listTeableTables({ baseId: selectedBaseId })
      .then(setTables)
      .catch(() => {})
      .finally(() => setLoadingTables(false));
  };

  if (!teableConnected) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Table Target
      </h2>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        {/* Space */}
        <div className="space-y-2">
          <Label>Space</Label>
          {loadingSpaces ? (
            <Skeleton className="h-9 w-full rounded-4xl" />
          ) : (
            <Select value={selectedSpaceId} onValueChange={handleSpaceChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a space…" />
              </SelectTrigger>
              <SelectContent>
                {spaces.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Base */}
        <div className="space-y-2">
          <Label>Base</Label>
          {loadingBases ? (
            <Skeleton className="h-9 w-full rounded-4xl" />
          ) : (
            <Select
              value={selectedBaseId}
              onValueChange={handleBaseChange}
              disabled={!selectedSpaceId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={selectedSpaceId ? "Select a base…" : "Select a space first"} />
              </SelectTrigger>
              <SelectContent>
                {bases.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Table */}
        <div className="space-y-2">
          <Label>Table (Laps)</Label>
          {loadingTables ? (
            <Skeleton className="h-9 w-full rounded-4xl" />
          ) : (
            <Select
              value={selectedTableId}
              onValueChange={handleTableChange}
              disabled={!selectedBaseId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={selectedBaseId ? "Select a table…" : "Select a base first"} />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Save button */}
        {canSave && (
          <Button
            onClick={() => void handleSave()}
            disabled={isTeableLoading}
            className="gap-2 w-full"
          >
            {isTeableLoading ? (
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
            ) : (
              <HugeiconsIcon icon={SaveIcon} strokeWidth={2} className="h-4 w-4" />
            )}
            Save Target Table
          </Button>
        )}

        {/* Schema status (shown after table is saved) */}
        {teableTableId && !hasChanges && (
          <SchemaStatus
            status={teableSchemaStatus}
            missingFields={teableMissingFields}
            isLoading={isTeableLoading}
            tableId={teableTableId}
            baseId={teableBaseId}
            onVerify={() => void verifyTeableSchema()}
            onPatch={() => void patchTeableSchema()}
            onCreateNew={() => setShowNewTableForm(true)}
          />
        )}

        {/* Create new table form */}
        {showNewTableForm && selectedBaseId && (
          <div className="space-y-2 pt-2 border-t border-border">
            <Label htmlFor="new-table-name">New table name</Label>
            <div className="flex gap-2">
              <Input
                id="new-table-name"
                placeholder="Laps"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleCreateTable(); }}
                disabled={isTeableLoading}
                className="flex-1"
              />
              <Button
                onClick={() => void handleCreateTable()}
                disabled={isTeableLoading || !newTableName.trim()}
                size="sm"
                className="gap-1.5 shrink-0"
              >
                {isTeableLoading ? (
                  <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={PlusSignSquareIcon} strokeWidth={2} className="h-4 w-4" />
                )}
                Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowNewTableForm(false); setNewTableName(""); }}
                disabled={isTeableLoading}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Schema status sub-component ──────────────────────────────────────────────

interface SchemaStatusProps {
  status: "unchecked" | "valid" | "missing";
  missingFields: string[];
  isLoading: boolean;
  tableId: string;
  baseId: string;
  onVerify: () => void;
  onPatch: () => void;
  onCreateNew: () => void;
}

function SchemaStatus({
  status,
  missingFields,
  isLoading,
  onVerify,
  onPatch,
  onCreateNew,
}: SchemaStatusProps) {
  if (status === "unchecked") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onVerify}
        disabled={isLoading}
        className="gap-2 w-full"
      >
        {isLoading ? (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
        ) : (
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="h-4 w-4" />
        )}
        Check Table Schema
      </Button>
    );
  }

  if (status === "valid") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="h-4 w-4 shrink-0" />
        All required columns are present
      </div>
    );
  }

  // status === "missing"
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} className="h-4 w-4 shrink-0" />
          Missing {missingFields.length} required column{missingFields.length > 1 ? "s" : ""}
        </div>
        <ul className="text-xs text-muted-foreground space-y-0.5 pl-6 list-disc">
          {missingFields.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onPatch}
          disabled={isLoading}
          className="flex-1 gap-2"
        >
          {isLoading ? (
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
          ) : (
            <HugeiconsIcon icon={PlusSignSquareIcon} strokeWidth={2} className="h-4 w-4" />
          )}
          Add Missing Columns
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateNew}
          disabled={isLoading}
          className="flex-1 gap-2"
        >
          <HugeiconsIcon icon={PlusSignSquareIcon} strokeWidth={2} className="h-4 w-4" />
          Create New Table
        </Button>
      </div>
    </div>
  );
}

// ─── Section 3: Sync toggle ───────────────────────────────────────────────────

function SyncToggleSection() {
  const teableConnected = useAppStore((s) => s.teableConnected);
  const teableTableId = useAppStore((s) => s.teableTableId);
  const teableSchemaStatus = useAppStore((s) => s.teableSchemaStatus);
  const teableSyncEnabled = useAppStore((s) => s.teableSyncEnabled);
  const setTeableSyncEnabled = useAppStore((s) => s.setTeableSyncEnabled);

  const canSync = teableConnected && !!teableTableId && teableSchemaStatus === "valid";

  if (!canSync) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Sync Settings
      </h2>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Enable Teable Sync</p>
            <p className="text-xs text-muted-foreground">
              Each completed lap will be saved to Teable in the background. Local storage is
              always used regardless of this setting.
            </p>
          </div>
          <Switch
            checked={teableSyncEnabled}
            onCheckedChange={(checked) => void setTeableSyncEnabled(checked)}
            aria-label="Enable Teable sync"
          />
        </div>
      </div>
    </section>
  );
}
