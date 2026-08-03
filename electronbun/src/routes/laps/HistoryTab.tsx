import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/stores/useAppStore";
import { SessionCard } from "./SessionCard";

const HISTORY_PAGE_SIZE = 10;

export function HistoryTab() {
  const lapHistory = useAppStore((s) => s.lapHistory);
  const fetchLapHistory = useAppStore((s) => s.fetchLapHistory);
  const deleteHistorySession = useAppStore((s) => s.deleteHistorySession);

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(lapHistory.total / HISTORY_PAGE_SIZE));

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      await fetchLapHistory(p, HISTORY_PAGE_SIZE);
    } catch {
      toast.error("Failed to load lap history");
    } finally {
      setLoading(false);
    }
  }, [fetchLapHistory]);

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

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (lapHistory.sessions.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} className="w-12 h-12 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No past sessions found.</p>
      </div>
    );
  }

  return (
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
        <div className="flex items-center justify-center gap-2 pt-2">
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
  );
}
