import { CloudOff } from "lucide-react";
import { useSync } from "../features/sync/SyncProvider";

export function OfflineBanner() {
  const { isOnline } = useSync();
  if (isOnline) return null;

  return (
    <section className="offline-banner" role="status" aria-live="polite">
      <CloudOff size={20} aria-hidden="true" />
      <div>
        <strong>Jesteś offline</strong>
        <span>Używam danych z ostatniej synchronizacji</span>
      </div>
    </section>
  );
}
