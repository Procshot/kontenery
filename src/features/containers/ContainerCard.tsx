import {
  CalendarDays,
  Clock3,
  ExternalLink,
  MapPin,
  Navigation,
  Ruler,
} from "lucide-react";
import type { ContainerRecord } from "../../db/db";
import { formatDate, formatDateRange } from "../../utils/date";
import {
  buildNavigationUrl,
  formatDaysRemaining,
  formatDistance,
  type TodayContainer,
} from "./todayService";

interface ContainerCardProps {
  container: ContainerRecord | TodayContainer;
  detailed?: boolean;
}

export function ContainerCard({
  container,
  detailed = false,
}: ContainerCardProps) {
  if (!detailed || !isTodayContainer(container)) {
    return (
      <article className="container-card">
        <div className="container-card__icon">
          <MapPin size={20} aria-hidden="true" />
        </div>
        <div className="container-card__body">
          <h3>{container.address}</h3>
          <p>{container.district}</p>
          <div className="container-card__date">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{formatDateRange(container.startDate, container.endDate)}</span>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="container-card container-card--detailed">
      <div className="container-card__header">
        <div className="container-card__icon">
          <MapPin size={20} aria-hidden="true" />
        </div>
        <div className="container-card__body">
          <h3>{container.address}</h3>
          <p>{container.district}</p>
        </div>
      </div>

      <dl className="container-card__details">
        <div>
          <dt>
            <CalendarDays size={16} aria-hidden="true" />
            Data podstawienia
          </dt>
          <dd>{formatDate(container.startDate)}</dd>
        </div>
        <div>
          <dt>
            <Clock3 size={16} aria-hidden="true" />
            Dostępność
          </dt>
          <dd>Stoi do {formatDate(container.endDate)}</dd>
        </div>
        <div>
          <dt>
            <Ruler size={16} aria-hidden="true" />
            Odległość
          </dt>
          <dd>{formatDistance(container.distanceMeters)}</dd>
        </div>
      </dl>

      <div className="container-card__footer">
        <span className="days-badge">
          Zostało {formatDaysRemaining(container.daysRemaining)}
        </span>
        <a
          className="navigate-button"
          href={buildNavigationUrl(container.lat, container.lng)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Nawiguj do kontenera: ${container.address}`}
        >
          <Navigation size={17} aria-hidden="true" />
          Nawiguj
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>

      <p className="container-card__accuracy">
        <MapPin size={13} aria-hidden="true" />
        Lokalizacja orientacyjna
      </p>
    </article>
  );
}

function isTodayContainer(
  container: ContainerRecord | TodayContainer,
): container is TodayContainer {
  return "distanceMeters" in container && "daysRemaining" in container;
}
