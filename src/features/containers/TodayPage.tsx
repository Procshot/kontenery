import { CalendarX2, LocateFixed, Search } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SyncStatusCard } from "../../components/SyncStatusCard";
import { getActiveContainers } from "../../db/db";
import {
  getSessionLocation,
  subscribeToLocation,
} from "../location/locationService";
import { todayInWarsaw } from "../../utils/date";
import { ContainerList } from "./ContainerList";
import {
  filterAndSortTodayContainers,
  type RadiusFilter,
} from "./todayService";

const radiusOptions: Array<{ value: RadiusFilter; label: string }> = [
  { value: 1, label: "1 km" },
  { value: 2, label: "2 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
  { value: "all", label: "Wszystkie" },
];

export function TodayPage() {
  const today = todayInWarsaw();
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState<RadiusFilter>("all");
  const location = useSyncExternalStore(
    subscribeToLocation,
    getSessionLocation,
    () => null,
  );
  const activeContainers = useLiveQuery(
    () => getActiveContainers(today),
    [today],
  );
  const visibleContainers = useMemo(
    () =>
      filterAndSortTodayContainers(
        activeContainers ?? [],
        today,
        location,
        { query, radius },
      ),
    [activeContainers, location, query, radius, today],
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Dzisiaj"
        title="Kontenery dostępne teraz"
        description="Aktualne wystawienia z lokalnej bazy. Lista działa również bez internetu."
      />
      <SyncStatusCard />

      <section className="today-filters" aria-label="Filtry kontenerów">
        <label className="today-search" htmlFor="today-search">
          <span>Adres lub osiedle</span>
          <div>
            <Search size={18} aria-hidden="true" />
            <input
              id="today-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj po adresie lub osiedlu"
              autoComplete="off"
            />
          </div>
        </label>

        <fieldset className="radius-filter">
          <legend>Promień wyszukiwania</legend>
          <div className="radius-filter__options">
            {radiusOptions.map((option) => {
              const disabled = !location && option.value !== "all";
              return (
                <label
                  key={option.value}
                  className={disabled ? "radius-filter__option--disabled" : ""}
                >
                  <input
                    type="radio"
                    name="radius"
                    value={option.value}
                    checked={radius === option.value}
                    disabled={disabled}
                    onChange={() => setRadius(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="location-sort-info">
          <LocateFixed size={17} aria-hidden="true" />
          {location ? (
            <span>
              Sortowanie od najbliższego punktu względem:{" "}
              <strong>{location.label}</strong>
            </span>
          ) : (
            <span>
              Brak lokalizacji. Lista jest sortowana po dacie i adresie.{" "}
              <Link to="/map">Ustaw lokalizację</Link>
            </span>
          )}
        </div>
      </section>

      <section className="results-section">
        <div className="section-heading">
          <h2>Aktualne wystawienia</h2>
          <span>{visibleContainers.length}</span>
        </div>

        {activeContainers === undefined ? (
          <div className="loading-list" aria-label="Ładowanie danych">
            <span />
            <span />
            <span />
          </div>
        ) : visibleContainers.length > 0 ? (
          <ContainerList
            containers={visibleContainers}
            detailed
          />
        ) : (
          <EmptyState
            icon={CalendarX2}
            title={
              activeContainers.length === 0
                ? "Brak danych na dzisiaj"
                : "Brak wyników dla filtrów"
            }
            description={
              activeContainers.length === 0
                ? "Uruchom synchronizację albo sprawdź zakładkę z następnym wystawieniem."
                : "Zwiększ promień albo zmień wyszukiwany adres lub osiedle."
            }
          />
        )}
      </section>
    </div>
  );
}
