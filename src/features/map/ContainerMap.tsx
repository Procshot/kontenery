import { useEffect, useMemo } from "react";
import { divIcon, type LatLngExpression } from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { ContainerRecord } from "../../db/db";
import { formatDate } from "../../utils/date";
import type { Coordinates } from "../location/locationService";
import { buildNavigationUrl } from "../containers/todayService";

const WROCLAW_CENTER: LatLngExpression = [51.1079, 17.0385];

interface ContainerMapProps {
  containers: readonly ContainerRecord[];
  userLocation: Coordinates | null;
  mode: "today" | "upcoming";
}

export function ContainerMap({
  containers,
  userLocation,
  mode,
}: ContainerMapProps) {
  const center: LatLngExpression = userLocation
    ? [userLocation.lat, userLocation.lng]
    : WROCLAW_CENTER;
  const zoom = userLocation ? 14 : 12;
  const markerIcon = useMemo(() => createMarkerIcon(mode), [mode]);

  return (
    <section className="container-map-shell" aria-label="Mapa kontenerów">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="container-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapViewport center={center} zoom={zoom} />

        {userLocation ? (
          <CircleMarker
            center={[userLocation.lat, userLocation.lng]}
            radius={9}
            pathOptions={{
              color: "#ffffff",
              fillColor: "#246342",
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Popup>Twoja lokalizacja</Popup>
          </CircleMarker>
        ) : null}

        {containers.map((container) => (
          <Marker
            key={`${mode}-${container.id}`}
            position={[container.lat, container.lng]}
            icon={markerIcon}
            title={container.address}
          >
            <Popup minWidth={220}>
              <div className="map-popup">
                <strong>{container.address}</strong>
                <span>{container.district}</span>
                <dl>
                  <div>
                    <dt>Podstawienie</dt>
                    <dd>{formatDate(container.startDate)}</dd>
                  </div>
                  <div>
                    <dt>Dostępny do</dt>
                    <dd>{formatDate(container.endDate)}</dd>
                  </div>
                </dl>
                <a
                  href={buildNavigationUrl(container.lat, container.lng)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Nawiguj
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div className="container-map__counter" aria-live="polite">
        {formatMarkerCount(containers.length)}
      </div>
    </section>
  );
}

function MapViewport({
  center,
  zoom,
}: {
  center: LatLngExpression;
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, zoom, { animate: true });
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => window.cancelAnimationFrame(frame);
  }, [center, map, zoom]);

  return null;
}

function createMarkerIcon(mode: "today" | "upcoming") {
  return divIcon({
    className: "container-map-marker",
    html: `<span class="container-map-marker__dot container-map-marker__dot--${mode}"></span>`,
    iconSize: [26, 34],
    iconAnchor: [13, 30],
    popupAnchor: [0, -29],
  });
}

function formatMarkerCount(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const label =
    count === 1
      ? "marker"
      : lastDigit >= 2 &&
          lastDigit <= 4 &&
          (lastTwoDigits < 12 || lastTwoDigits > 14)
        ? "markery"
        : "markerów";

  return `${count.toLocaleString("pl-PL")} ${label}`;
}
