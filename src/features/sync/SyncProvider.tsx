import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSyncMeta } from "../../db/db";
import { useOnlineStatus } from "../location/useOnlineStatus";
import {
  SyncError,
  synchronizeLocalDatabase,
  type SyncResult,
} from "./syncService";

const AUTO_SYNC_STORAGE_KEY = "containers:last-auto-sync-check";
const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SyncNotice {
  type: "success" | "warning" | "error";
  message: string;
  details?: string;
}

interface SyncContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  recordCount: number;
  lastSync: string | null;
  dataVersion: string | null;
  dateMin: string | null;
  dateMax: string | null;
  notice: SyncNotice | null;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const isOnline = useOnlineStatus();
  const count = useLiveQuery(() => db.containers.count(), []);
  const syncMeta = useLiveQuery(() => getSyncMeta(), [], null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const syncLock = useRef(false);

  const performSync = useCallback(
    async (mode: "manual" | "automatic") => {
      if (syncLock.current) return;

      syncLock.current = true;
      setIsSyncing(true);
      if (mode === "manual") setNotice(null);

      try {
        const result = await synchronizeLocalDatabase();
        markAutomaticSyncAttempt();
        setNotice(buildSuccessNotice(result));
      } catch (error) {
        setNotice(buildErrorNotice(error));
      } finally {
        syncLock.current = false;
        setIsSyncing(false);
      }
    },
    [isOnline],
  );

  const syncNow = useCallback(
    async () => performSync("manual"),
    [performSync],
  );

  useEffect(() => {
    if (!isOnline || !shouldRunAutomaticSync()) return;

    // Zapis przed rozpoczęciem zapobiega podwójnemu pobraniu m.in. w StrictMode.
    markAutomaticSyncAttempt();
    void performSync("automatic");
  }, [isOnline, performSync]);

  const value = useMemo<SyncContextValue>(
    () => ({
      isOnline,
      isSyncing,
      recordCount: count ?? 0,
      lastSync: syncMeta?.syncedAt ?? null,
      dataVersion: syncMeta?.dataVersion ?? null,
      dateMin: syncMeta?.dateMin ?? null,
      dateMax: syncMeta?.dateMax ?? null,
      notice,
      syncNow,
    }),
    [
      count,
      isOnline,
      isSyncing,
      notice,
      syncMeta?.dataVersion,
      syncMeta?.dateMax,
      syncMeta?.dateMin,
      syncMeta?.syncedAt,
      syncNow,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync musi być użyty wewnątrz SyncProvider.");
  }
  return context;
}

function buildSuccessNotice(result: SyncResult): SyncNotice {
  if (result.source === "indexeddb") {
    return {
      type: "warning",
      message: "Brak internetu — używam ostatnich danych",
      details: `W pamięci urządzenia jest ${result.availableRecords.toLocaleString(
        "pl-PL",
      )} rekordów.`,
    };
  }

  if (result.rejectedRecords === 0) {
    return {
      type: "success",
      message: "Dane zsynchronizowane",
      details: `Zapisano ${result.importedRecords.toLocaleString("pl-PL")} rekordów.`,
    };
  }

  return {
    type: "warning",
    message: "Dane zsynchronizowane",
    details: `Zapisano ${result.importedRecords.toLocaleString(
      "pl-PL",
    )} rekordów. Pominięto ${result.rejectedRecords.toLocaleString(
      "pl-PL",
    )} niepoprawnych rekordów.`,
  };
}

function buildErrorNotice(error: unknown): SyncNotice {
  if (error instanceof SyncError && error.code === "offline") {
    return {
      type: "warning",
      message: "Brak internetu — używam ostatnich danych",
    };
  }

  return {
    type: "error",
    message: "Nie udało się zsynchronizować",
    details:
      error instanceof Error
        ? error.message
        : "Wystąpił nieoczekiwany błąd synchronizacji.",
  };
}

function shouldRunAutomaticSync(): boolean {
  try {
    const storedValue = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    if (!storedValue) return true;

    const lastAttempt = Number(storedValue);
    return (
      !Number.isFinite(lastAttempt) ||
      Date.now() - lastAttempt >= AUTO_SYNC_INTERVAL_MS
    );
  } catch {
    return true;
  }
}

function markAutomaticSyncAttempt(): void {
  try {
    localStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(Date.now()));
  } catch {
    // Brak localStorage nie może blokować ręcznej synchronizacji ani odczytu bazy.
  }
}
