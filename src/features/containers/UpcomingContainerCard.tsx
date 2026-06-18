import {
  CalendarDays,
  ExternalLink,
  MapPin,
  Navigation,
  Ruler,
} from "lucide-react";
import { formatDate } from "../../utils/date";
import { buildNavigationUrl, formatDistance } from "./todayService";
import type { UpcomingContainer } from "./nextService";

export function UpcomingContainerCard({
  container,
}: {
  container: UpcomingContainer;
}) {
  return (
    <article className="container-card upcoming-card">
      <div className="container-card__header">
        <div className="container-card__icon">
          <MapPin size={20} aria-hidden="true" />
        </div>
        <div className="container-card__body">
          <h3>{container.address}</h3>
          <p>{container.district}</p>
        </div>
      </div>

      <div className="upcoming-card__meta">
        <span>
          <CalendarDays size={16} aria-hidden="true" />
          {formatDate(container.startDate)}
        </span>
        <span>
          <Ruler size={16} aria-hidden="true" />
          {formatDistance(container.distanceMeters)}
        </span>
      </div>

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
    </article>
  );
}
