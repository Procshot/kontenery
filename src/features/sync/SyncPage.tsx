import {
  CheckCircle2,
  CloudOff,
  Database,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { DatabaseDiagnostics } from "./DatabaseDiagnostics";
import { InstallInstructions } from "./InstallInstructions";
import { useSync } from "./SyncProvider";

export function SyncPage() {
  const { isOnline, isSyncing, notice, syncNow } = useSync();
  const visibleNotice = !isOnline
    ? {
        type: "warning" as const,
        message: "Brak internetu — używam ostatnich danych",
      }
    : notice;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ustawienia"
        title="Synchronizacja"
        description="Pobierz najnowszy zestaw danych i zapisz go lokalnie na tym urządzeniu."
      />

      <DatabaseDiagnostics />

      <section className="panel">
        <div className="panel__title">
          <Database size={21} aria-hidden="true" />
          <h2>Aktualizacja danych</h2>
        </div>
        <p className="panel__description">
          Plik danych jest walidowany przed zapisem. Poprzednia wersja bazy
          pozostaje dostępna, jeżeli synchronizacja zakończy się błędem.
        </p>

        <button
          className="primary-button"
          type="button"
          disabled={isSyncing}
          onClick={() => void syncNow()}
        >
          {isOnline ? (
            <RefreshCw
              size={19}
              className={isSyncing ? "spin" : undefined}
              aria-hidden="true"
            />
          ) : (
            <CloudOff size={19} aria-hidden="true" />
          )}
          {isSyncing
            ? "Synchronizowanie..."
            : "Synchronizuj dane"}
        </button>

        {visibleNotice ? (
          <div
            className={`message message--${visibleNotice.type}`}
            role={visibleNotice.type === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            <strong>{visibleNotice.message}</strong>
            {"details" in visibleNotice && visibleNotice.details ? (
              <span>{visibleNotice.details}</span>
            ) : null}
          </div>
        ) : null}
      </section>

      <InstallInstructions />

      <section className="panel info-panel">
        <div>
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <h2>Działanie offline</h2>
            <p>
              Po pierwszej synchronizacji lista kontenerów jest dostępna z
              IndexedDB, również bez internetu.
            </p>
          </div>
        </div>
        <div>
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <h2>Aktualizacja atomowa</h2>
            <p>
              Nowy zestaw zastępuje poprzedni w jednej transakcji, bez
              częściowo zapisanych danych.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
