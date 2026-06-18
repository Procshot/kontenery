import { CloudOff, Info, Wifi } from "lucide-react";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import {
  getActiveContainers,
  getUpcomingContainers,
} from "../../db/db";
import { todayInWarsaw } from "../../utils/date";
import { useUserLocation } from "../location/locationStore";
import { useOnlineStatus } from "../location/useOnlineStatus";
import { ContainerMap } from "./ContainerMap";

type MapMode = "today" | "upcoming";

export function MapPage() {
  const today = todayInWarsaw();
  const [mode, setMode] = useState<MapMode>("today");
  const isOnline = useOnlineStatus();
  const location = useUserLocation();
  const data = useLiveQuery(async () => {
    const [active, upcoming] = await Promise.all([
      getActiveContainers(today),
      getUpcomingContainers(today, 14),
    ]);
    return { active, upcoming };
  }, [today]);
  const containers = mode === "today" ? data?.active ?? [] : data?.upcoming ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Mapa"
        title="Kontenery na mapie"
        description="Zobacz aktualne i planowane punkty. Markery pochodzą z lokalnej bazy IndexedDB."
      />

      <section className="map-controls" aria-label="Zakres danych mapy">
        <div className="map-mode-switch" role="group" aria-label="Termin">
          <button
            type="button"
            className={mode === "today" ? "map-mode-switch__active" : undefined}
            aria-pressed={mode === "today"}
            onClick={() => setMode("today")}
          >
            Dzisiaj
          </button>
          <button
            type="button"
            className={
              mode === "upcoming" ? "map-mode-switch__active" : undefined
            }
            aria-pressed={mode === "upcoming"}
            onClick={() => setMode("upcoming")}
          >
            Najbliższe 14 dni
          </button>
        </div>

        <div
          className={`map-connectivity ${
            isOnline
              ? "map-connectivity--online"
              : "map-connectivity--offline"
          }`}
          role="status"
        >
          {isOnline ? (
            <Wifi size={17} aria-hidden="true" />
          ) : (
            <CloudOff size={17} aria-hidden="true" />
          )}
          <span>
            {isOnline
              ? "Kafelki mapy wymagają internetu."
              : "Brak internetu: kafelki mogą być niedostępne, ale lista kontenerów nadal działa offline."}
          </span>
        </div>
      </section>

      {!location ? (
        <div className="location-sort-info" role="status">
          <Info size={17} aria-hidden="true" />
          <span>
            Ustaw lokalizację w zakładce Dzisiaj, aby zobaczyć najbliższe
            kontenery. <Link to="/">Przejdź do Dzisiaj</Link>
          </span>
        </div>
      ) : null}

      {data === undefined ? (
        <div className="map-loading" aria-label="Ładowanie mapy">
          <span />
        </div>
      ) : (
        <ContainerMap
          containers={containers}
          userLocation={location}
          mode={mode}
        />
      )}

      <div className="map-offline-note">
        <Info size={18} aria-hidden="true" />
        <p>
          Kafelki OpenStreetMap nie są zapisywane do użytku offline. Dane
          kontenerów i pozostałe listy aplikacji pozostają dostępne z IndexedDB.
        </p>
      </div>
    </div>
  );
}
