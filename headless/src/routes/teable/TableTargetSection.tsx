import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  SaveIcon,
  PlusSignSquareIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { SchemaStatus } from "./SchemaStatus";

export function TableTargetSection() {
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
