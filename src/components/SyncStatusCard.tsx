import { CloudOff, Database, RefreshCw, Wifi } from "lucide-react";
import { useSync } from "../features/sync/SyncProvider";
import { formatDateTime } from "../utils/date";

export function SyncStatusCard() {
  const { isOnline, isSyncing, lastSync, recordCount } = useSync();

  return (
    <section className="status-card" aria-label="Status danych">
      <div className="status-card__header">
        <div>
          <p className="eyebrow">Dane lokalne</p>
          <h2>Status aplikacji</h2>
        </div>
        <span
          className={`connection-pill ${
            isOnline ? "connection-pill--online" : "connection-pill--offline"
          }`}
        >
          {isOnline ? (
            <Wifi size={15} aria-hidden="true" />
          ) : (
            <CloudOff size={15} aria-hidden="true" />
          )}
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      <div className="status-grid">
        <div className="status-metric">
          <RefreshCw
            size={18}
            className={isSyncing ? "spin" : undefined}
            aria-hidden="true"
          />
          <span>Ostatnia synchronizacja</span>
          <strong>{lastSync ? formatDateTime(lastSync) : "Jeszcze nie wykonano"}</strong>
        </div>
        <div className="status-metric">
          <Database size={18} aria-hidden="true" />
          <span>Rekordy w urządzeniu</span>
          <strong>{recordCount.toLocaleString("pl-PL")}</strong>
        </div>
      </div>
    </section>
  );
}
