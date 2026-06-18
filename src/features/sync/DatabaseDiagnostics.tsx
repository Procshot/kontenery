import {
  Activity,
  CalendarRange,
  CloudOff,
  Database,
  Wifi,
} from "lucide-react";
import { useSync } from "./SyncProvider";
import { formatDate, formatDateTime } from "../../utils/date";

export function DatabaseDiagnostics() {
  const {
    dataVersion,
    dateMax,
    dateMin,
    isOnline,
    lastSync,
    recordCount,
  } = useSync();

  return (
    <section className="panel" aria-labelledby="database-diagnostics-title">
      <div className="panel__title">
        <Activity size={21} aria-hidden="true" />
        <h2 id="database-diagnostics-title">Diagnostyka bazy</h2>
      </div>

      <dl className="details-list">
        <div>
          <dt>
            {isOnline ? (
              <Wifi size={16} aria-hidden="true" />
            ) : (
              <CloudOff size={16} aria-hidden="true" />
            )}{" "}
            Status
          </dt>
          <dd>
            <span
              className={`connection-pill ${
                isOnline
                  ? "connection-pill--online"
                  : "connection-pill--offline"
              }`}
            >
              {isOnline ? "Online" : "Offline"}
            </span>
          </dd>
        </div>
        <div>
          <dt>
            <Database size={16} aria-hidden="true" /> Rekordy
          </dt>
          <dd>{recordCount.toLocaleString("pl-PL")}</dd>
        </div>
        <div>
          <dt>Ostatnia synchronizacja</dt>
          <dd>{lastSync ? formatDateTime(lastSync) : "Brak"}</dd>
        </div>
        <div>
          <dt>
            <CalendarRange size={16} aria-hidden="true" /> Zakres dat
          </dt>
          <dd>
            {dateMin && dateMax
              ? `${formatDate(dateMin)} - ${formatDate(dateMax)}`
              : "Brak danych"}
          </dd>
        </div>
        <div>
          <dt>Wersja synchronizacji</dt>
          <dd className="details-list__version">
            {formatSyncVersion(dataVersion)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function formatSyncVersion(value: string | null): string {
  if (!value) return "Brak";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : formatDateTime(value);
}
