import type { StateCreator } from "zustand";
import { toast } from "sonner";
import type { AppSettings, TeableUser, TeableSchemaCheck } from "@/shared/types";
import { getRpc } from "@/lib/rpc";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TeableSchemaStatus = "unchecked" | "valid" | "missing";

export interface TeableSlice {
  // Persisted state (mirrors settings)
  teableUrl: string;
  teableUserName: string;
  teableUserEmail: string;
  teableUserAvatar: string;
  teableSpaceId: string;
  teableBaseId: string;
  teableTableId: string;
  teableSyncEnabled: boolean;

  // Derived / transient
  teableConnected: boolean;
  isTeableLoading: boolean;
  teableSchemaStatus: TeableSchemaStatus;
  teableMissingFields: string[];

  // Actions
  loadTeableState: () => Promise<void>;
  connectTeable: (url: string, token: string) => Promise<TeableUser>;
  disconnectTeable: () => Promise<void>;
  saveTeableTableTarget: (spaceId: string, baseId: string, tableId: string) => Promise<void>;
  verifyTeableSchema: (tableId?: string) => Promise<void>;
  patchTeableSchema: (tableId?: string) => Promise<void>;
  createAndSelectTable: (baseId: string, tableName: string) => Promise<void>;
  setTeableSyncEnabled: (enabled: boolean) => Promise<void>;
}

// ─── Slice ────────────────────────────────────────────────────────────────────

export const createTeableSlice: StateCreator<TeableSlice, [], [], TeableSlice> = (set, get) => ({
  teableUrl: "",
  teableUserName: "",
  teableUserEmail: "",
  teableUserAvatar: "",
  teableSpaceId: "",
  teableBaseId: "",
  teableTableId: "",
  teableSyncEnabled: false,
  teableConnected: false,
  isTeableLoading: false,
  teableSchemaStatus: "unchecked",
  teableMissingFields: [],

  // ── Load persisted settings ────────────────────────────────────────────────

  loadTeableState: async () => {
    const settings = await getRpc().request.getSettings({});
    const connected = !!(settings.teableUrl && settings.teableToken);
    set({
      teableUrl: settings.teableUrl,
      teableUserName: settings.teableUserName,
      teableUserEmail: settings.teableUserEmail,
      teableUserAvatar: settings.teableUserAvatar,
      teableSpaceId: settings.teableSpaceId,
      teableBaseId: settings.teableBaseId,
      teableTableId: settings.teableTableId,
      teableSyncEnabled: settings.teableSyncEnabled === "true",
      teableConnected: connected,
      teableSchemaStatus: "unchecked",
    });
  },

  // ── Connection ─────────────────────────────────────────────────────────────

  connectTeable: async (url, token) => {
    set({ isTeableLoading: true });
    try {
      const user = await getRpc().request.testTeableConnection({ url, token });
      await getRpc().request.saveTeableConfig({
        url,
        token,
        userName: user.name,
        userEmail: user.email,
        userAvatar: user.avatar,
      });
      set({
        teableUrl: url,
        teableUserName: user.name,
        teableUserEmail: user.email,
        teableUserAvatar: user.avatar ?? "",
        teableConnected: true,
        teableSchemaStatus: "unchecked",
        teableMissingFields: [],
      });
      return user;
    } finally {
      set({ isTeableLoading: false });
    }
  },

  disconnectTeable: async () => {
    set({ isTeableLoading: true });
    try {
      await getRpc().request.removeTeableConfig({});
      set({
        teableUrl: "",
        teableUserName: "",
        teableUserEmail: "",
        teableUserAvatar: "",
        teableSpaceId: "",
        teableBaseId: "",
        teableTableId: "",
        teableSyncEnabled: false,
        teableConnected: false,
        teableSchemaStatus: "unchecked",
        teableMissingFields: [],
      });
    } finally {
      set({ isTeableLoading: false });
    }
  },

  // ── Table target ───────────────────────────────────────────────────────────

  saveTeableTableTarget: async (spaceId, baseId, tableId) => {
    await getRpc().request.saveTeableTarget({ spaceId, baseId, tableId });
    set({
      teableSpaceId: spaceId,
      teableBaseId: baseId,
      teableTableId: tableId,
      teableSchemaStatus: "unchecked",
      teableMissingFields: [],
    });
  },

  // ── Schema management ──────────────────────────────────────────────────────

  verifyTeableSchema: async (tableId?: string) => {
    const id = tableId ?? get().teableTableId;
    if (!id) return;
    set({ isTeableLoading: true });
    try {
      const check: TeableSchemaCheck = await getRpc().request.verifyTeableTable({ tableId: id });
      set({
        teableSchemaStatus: check.missingFields.length === 0 ? "valid" : "missing",
        teableMissingFields: check.missingFields,
      });
    } catch (e) {
      toast.error(`Schema check failed: ${String(e)}`);
    } finally {
      set({ isTeableLoading: false });
    }
  },

  patchTeableSchema: async (tableId?: string) => {
    const id = tableId ?? get().teableTableId;
    if (!id) return;
    set({ isTeableLoading: true });
    try {
      const created = await getRpc().request.ensureTeableFields({ tableId: id });
      toast.success(
        created.length > 0
          ? `Added ${created.length} missing field${created.length > 1 ? "s" : ""}`
          : "All fields already present"
      );
      set({ teableSchemaStatus: "valid", teableMissingFields: [] });
    } catch (e) {
      toast.error(`Failed to add fields: ${String(e)}`);
    } finally {
      set({ isTeableLoading: false });
    }
  },

  createAndSelectTable: async (baseId, tableName) => {
    set({ isTeableLoading: true });
    try {
      const table = await getRpc().request.createTeableTable({ baseId, tableName });
      await getRpc().request.saveTeableTarget({
        spaceId: get().teableSpaceId,
        baseId,
        tableId: table.id,
      });
      set({
        teableBaseId: baseId,
        teableTableId: table.id,
        teableSchemaStatus: "valid",
        teableMissingFields: [],
      });
      toast.success(`Table "${table.name}" created`);
    } catch (e) {
      toast.error(`Failed to create table: ${String(e)}`);
    } finally {
      set({ isTeableLoading: false });
    }
  },

  // ── Sync toggle ────────────────────────────────────────────────────────────

  setTeableSyncEnabled: async (enabled) => {
    await getRpc().request.saveSetting({
      key: "teableSyncEnabled" as keyof AppSettings,
      value: enabled ? "true" : "false",
    });
    set({ teableSyncEnabled: enabled });
  },
});
