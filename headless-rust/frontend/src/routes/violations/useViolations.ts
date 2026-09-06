import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import { useBackendEvent } from "@/hooks/useBackendEvent";
import type { Violation, ViolationQuery } from "@/shared/types";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type ViewMode = "list" | "grid";

const VIEW_MODE_KEY = "violations_view_mode";

export function readViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
  if (stored) return stored;
  // ponytail: default to grid on mobile so cards render without horizontal overflow
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return "grid";
  }
  return "list";
}

export function writeViewMode(mode: ViewMode) {
  localStorage.setItem(VIEW_MODE_KEY, mode);
}

export interface ViolationsState {
  violations: Violation[];
  total: number;
  page: number;
  limit: PageSize;
  dateFrom: string;
  dateTo: string;
  minSpeed: string;
  loading: boolean;
  selected: Set<number>;
  totalPages: number;
  allSelected: boolean;
  someSelected: boolean;
  setPage: (p: number) => void;
  setLimit: (l: PageSize) => void;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  setMinSpeed: (v: string) => void;
  applyFilters: () => void;
  toggleSelect: (id: number) => void;
  toggleSelectAll: () => void;
  deleteViolation: (id: number) => Promise<void>;
  bulkDelete: () => Promise<void>;
  exportCsv: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useViolations(): ViolationsState {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<PageSize>(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minSpeed, setMinSpeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const fetchViolations = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const query: ViolationQuery = {
        page,
        limit,
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(minSpeed ? { minSpeed: Number(minSpeed) } : {}),
      };
      const result = await getRpc().request.getViolations(query);
      setViolations(result.violations);
      setTotal(result.total);
    } catch {
      toast.error("Failed to load violations");
    } finally {
      setLoading(false);
    }
  }, [page, limit, dateFrom, dateTo, minSpeed]);

  useEffect(() => {
    void fetchViolations();
  }, [fetchViolations]);

  // Real-time listener for newly captured violations
  useBackendEvent("violation", (newViolation) => {
    // If on first page and no active filter, prepend directly for zero-latency UI update
    if (page === 1 && !dateFrom && !dateTo && !minSpeed) {
      setViolations((prev) => {
        if (prev.some((v) => v.id === newViolation.id)) return prev;
        return [newViolation, ...prev.slice(0, limit - 1)];
      });
      setTotal((prev) => prev + 1);
    } else {
      // Otherwise trigger refetch to keep pagination counts consistent
      void fetchViolations();
    }
  });

  const deleteViolation = useCallback(async (id: number) => {
    try {
      await getRpc().request.deleteViolation({ id });
      setViolations((prev) => prev.filter((v) => v.id !== id));
      setTotal((prev) => prev - 1);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      toast.error("Failed to delete violation");
    }
  }, []);

  const bulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      await Promise.all(
        [...selected].map((id) => getRpc().request.deleteViolation({ id })),
      );
      await fetchViolations();
      toast.success(`Deleted ${selected.size} violations`);
    } catch {
      toast.error("Failed to delete some violations");
    }
  }, [selected, fetchViolations]);

  const exportCsv = useCallback(async () => {
    try {
      const csv = await getRpc().request.exportViolationsCsv({
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(minSpeed ? { minSpeed: Number(minSpeed) } : {}),
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export CSV");
    }
  }, [dateFrom, dateTo, minSpeed]);

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = violations.length > 0 && violations.every((v) => selected.has(v.id));
  const someSelected = violations.some((v) => selected.has(v.id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      violations.length > 0 && violations.every((v) => prev.has(v.id))
        ? new Set()
        : new Set(violations.map((v) => v.id)),
    );
  }, [violations]);

  const applyFilters = useCallback(() => {
    setPage(1);
    void fetchViolations();
  }, [fetchViolations]);

  return {
    violations,
    total,
    page,
    limit,
    dateFrom,
    dateTo,
    minSpeed,
    loading,
    selected,
    totalPages,
    allSelected,
    someSelected,
    setPage,
    setLimit,
    setDateFrom,
    setDateTo,
    setMinSpeed,
    applyFilters,
    toggleSelect,
    toggleSelectAll,
    deleteViolation,
    bulkDelete,
    exportCsv,
    refetch: fetchViolations,
  };
}
