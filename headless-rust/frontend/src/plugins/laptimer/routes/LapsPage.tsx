import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLapStore } from "../store";
import { SessionCard } from "./SessionCard";

const HISTORY_PAGE_SIZE = 10;

// ponytail: pure data listing interface for recorded laps, matching violations page pattern
export function LapsPage() {
  const lapHistory = useLapStore((s) => s.lapHistory);
  const fetchLapHistory = useLapStore((s) => s.fetchLapHistory);
  const deleteHistorySession = useLapStore((s) => s.deleteHistorySession);

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(lapHistory.total / HISTORY_PAGE_SIZE));

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        await fetchLapHistory(p, HISTORY_PAGE_SIZE);
      } catch {
        toast.error("Failed to load lap history");
      } finally {
        setLoading(false);
      }
    },
    [fetchLapHistory],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const handleDeleteSession = async (id: number) => {
    if (!confirm("Delete this session and all its laps?")) return;
    setDeletingId(id);
    try {
      await deleteHistorySession(id);
      if (page > 1 && lapHistory.sessions.length === 1) {
        setPage((p) => p - 1);
      }
      toast.success("Session deleted");
    } catch {
      toast.error("Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Recorded Lap Sessions</span>
          <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted font-mono">
            {lapHistory.total} total
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load(page)}
          disabled={loading}
          className="h-8 px-2 text-xs"
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="w-3.5 h-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Main content list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="max-w-3xl mx-auto space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : lapHistory.sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <HugeiconsIcon
              icon={Clock01Icon}
              strokeWidth={1.5}
              className="w-12 h-12 text-muted-foreground/40"
            />
            <p className="text-sm text-muted-foreground">No past lap sessions recorded yet.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-3">
            {lapHistory.sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                deleting={deletingId === session.id}
                onDelete={() => handleDeleteSession(session.id)}
              />
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

