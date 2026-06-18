import { CalendarX2, LocateFixed } from "lucide-react";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { getActiveContainers } from "../../db/db";
import { todayInWarsaw } from "../../utils/date";
import { LocationSetupCard } from "../location/LocationSetupCard";
import { useUserLocation } from "../location/locationStore";
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
  const [radius, setRadius] = useState<RadiusFilter>("all");
  const location = useUserLocation();
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
        { radius },
      ),
    [activeContainers, location, radius, today],
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Dzisiaj"
        title="Kontenery dostępne teraz"
        description="Aktualne wystawienia z lokalnej bazy. Lista działa również bez internetu."
      />
      <LocationSetupCard />

      <section className="today-filters" aria-label="Filtry kontenerów">
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
              Ustaw lokalizację, aby posortować kontenery według odległości.
              Lista jest teraz sortowana po dacie i adresie.
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
                : "Brak kontenerów w wybranym promieniu"
            }
            description={
              activeContainers.length === 0
                ? "Uruchom synchronizację albo sprawdź zakładkę z następnym wystawieniem."
                : "Zwiększ promień albo wybierz wszystkie kontenery."
            }
          />
        )}
      </section>
    </div>
  );
}
