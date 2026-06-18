import { CalendarSearch, LocateFixed } from "lucide-react";
import {
  useMemo,
  useState,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { getUpcomingContainers } from "../../db/db";
import { useUserLocation } from "../location/locationStore";
import { todayInWarsaw } from "../../utils/date";
import {
  groupUpcomingContainers,
  type UpcomingRadiusKm,
} from "./nextService";
import { UpcomingContainerCard } from "./UpcomingContainerCard";

const radiusOptions: UpcomingRadiusKm[] = [1, 2, 5, 10];

export function NextPage() {
  const today = todayInWarsaw();
  const [radiusEnabled, setRadiusEnabled] = useState(false);
  const [radiusKm, setRadiusKm] = useState<UpcomingRadiusKm>(5);
  const location = useUserLocation();
  const upcomingContainers = useLiveQuery(
    () => getUpcomingContainers(today, 14),
    [today],
  );
  const groups = useMemo(
    () =>
      groupUpcomingContainers(
        upcomingContainers ?? [],
        today,
        location,
        radiusEnabled && location ? radiusKm : null,
      ),
    [location, radiusEnabled, radiusKm, today, upcomingContainers],
  );
  const visibleCount = groups.reduce(
    (total, group) => total + group.containers.length,
    0,
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Następne wystawienie"
        title="Najbliższe 14 dni"
        description="Planowane podstawienia pogrupowane według daty. Dane są odczytywane z lokalnej bazy."
      />

      <section className="upcoming-controls" aria-label="Filtr odległości">
        <label
          className={`radius-toggle${!location ? " radius-toggle--disabled" : ""}`}
        >
          <input
            type="checkbox"
            checked={radiusEnabled && location !== null}
            disabled={!location}
            onChange={(event) => setRadiusEnabled(event.currentTarget.checked)}
          />
          <span>
            <strong>Pokaż tylko w promieniu</strong>
            <small>
              {location
                ? `Względem lokalizacji: ${location.label}`
                : "Najpierw ustaw lokalizację użytkownika."}
            </small>
          </span>
        </label>

        <label className="radius-select">
          <span>Promień</span>
          <select
            value={radiusKm}
            disabled={!location || !radiusEnabled}
            onChange={(event) =>
              setRadiusKm(Number(event.currentTarget.value) as UpcomingRadiusKm)
            }
          >
            {radiusOptions.map((radius) => (
              <option key={radius} value={radius}>
                {radius} km
              </option>
            ))}
          </select>
        </label>

        <div className="location-sort-info">
          <LocateFixed size={17} aria-hidden="true" />
          {location ? (
            <span>
              Lokalizacja używana do sortowania: <strong>{location.label}</strong>.
              W każdej dacie najbliższe kontenery są pokazane jako pierwsze.
            </span>
          ) : (
            <span>
              Ustaw lokalizację w zakładce Dzisiaj, aby sortować według
              odległości. <Link to="/">Przejdź do Dzisiaj</Link>
            </span>
          )}
        </div>
      </section>

      <section className="results-section">
        <div className="section-heading">
          <h2>Planowane kontenery</h2>
          <span>{visibleCount}</span>
        </div>

        {upcomingContainers === undefined ? (
          <div className="loading-list" aria-label="Ładowanie danych">
            <span />
            <span />
          </div>
        ) : groups.length > 0 ? (
          <div className="upcoming-groups">
            {groups.map((group) => (
              <section
                className="upcoming-group"
                key={group.date}
                aria-labelledby={`upcoming-${group.date}`}
              >
                <header className="upcoming-group__header">
                  <div>
                    <p>{group.daysFromToday === 1 ? "Najbliższy termin" : "Termin"}</p>
                    <h3 id={`upcoming-${group.date}`}>{group.label}</h3>
                  </div>
                  <span>{group.containers.length}</span>
                </header>
                <div className="upcoming-card-list">
                  {group.containers.map((container) => (
                    <UpcomingContainerCard
                      key={container.id}
                      container={container}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CalendarSearch}
            title={
              upcomingContainers.length === 0
                ? "Brak wystawień w najbliższych 14 dniach"
                : "Brak kontenerów w wybranym promieniu"
            }
            description={
              upcomingContainers.length === 0
                ? "Zsynchronizuj dane, aby pobrać aktualny harmonogram."
                : "Zwiększ promień albo wyłącz filtr odległości."
            }
          />
        )}
      </section>
    </div>
  );
}
