import {
  Crosshair,
  LocateFixed,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getAllContainers, type ContainerRecord } from "../../db/db";
import {
  calculateDistanceMeters,
  clearRememberedLocation,
  findAddressMatch,
  getCurrentPosition,
  getRememberedLocation,
  saveRememberedLocation,
  setSessionLocation,
  sortByDistance,
  type Coordinates,
  type RememberedLocation,
} from "./locationService";

type LocationState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      origin: Coordinates;
      accuracy: number | null;
      label: string;
      source: "device" | "address";
    }
  | { status: "error"; message: string };

export function LocationPanel() {
  const [initialLocation] = useState(() => getRememberedLocation());
  const [location, setLocation] = useState<LocationState>(() =>
    initialLocation ? stateFromRememberedLocation(initialLocation) : { status: "idle" },
  );
  const [rememberLocation, setRememberLocation] = useState(
    () => initialLocation !== null,
  );
  const [address, setAddress] = useState("");
  const records = useLiveQuery(() => getAllContainers(), [], []);
  const nearestContainer = useMemo(
    () =>
      location.status === "ready"
        ? findNearestUniqueContainer(records, location.origin)
        : null,
    [location, records],
  );

  async function requestLocation() {
    setLocation({ status: "loading" });

    try {
      const currentPosition = await getCurrentPosition();
      const nextLocation: LocationState = {
        status: "ready",
        origin: currentPosition,
        accuracy: currentPosition.accuracy,
        label: "Bieżąca lokalizacja urządzenia",
        source: "device",
      };

      setLocation(nextLocation);
      persistLocationIfAllowed(nextLocation, rememberLocation);
    } catch (error) {
      setLocation({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Nie udało się pobrać lokalizacji.",
      });
    }
  }

  function searchAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = findAddressMatch(records, address);

    if (!match) {
      setLocation({
        status: "error",
        message:
          "Nie znaleziono podobnego adresu w lokalnej bazie. Geokodowanie online zostanie dodane później.",
      });
      return;
    }

    const nextLocation: LocationState = {
      status: "ready",
      origin: { lat: match.lat, lng: match.lng },
      accuracy: null,
      label: match.address,
      source: "address",
    };

    setAddress(match.address);
    setLocation(nextLocation);
    persistLocationIfAllowed(nextLocation, rememberLocation);
  }

  function changeRememberPreference(checked: boolean) {
    setRememberLocation(checked);

    if (!checked) {
      clearRememberedLocation();
      return;
    }

    persistLocationIfAllowed(location, true);
  }

  return (
    <section className="panel location-panel">
      <div className="panel__title">
        <LocateFixed size={21} aria-hidden="true" />
        <h2>Twoja lokalizacja</h2>
      </div>
      <p>
        Lokalizacja służy wyłącznie do liczenia odległości na tym urządzeniu.
        Nie wysyłamy jej na serwer.
      </p>

      <button
        className="secondary-button location-panel__gps"
        type="button"
        onClick={() => void requestLocation()}
        disabled={location.status === "loading"}
      >
        <Crosshair size={18} aria-hidden="true" />
        {location.status === "loading"
          ? "Pobieranie lokalizacji..."
          : "Użyj lokalizacji urządzenia"}
      </button>

      <div className="location-panel__divider">
        <span>lub wpisz adres</span>
      </div>

      <form className="address-search" onSubmit={searchAddress}>
        <label htmlFor="location-address">Adres we Wrocławiu</label>
        <div className="address-search__controls">
          <input
            id="location-address"
            type="search"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="np. Dębowa 2a"
            autoComplete="street-address"
            minLength={3}
            required
          />
          <button className="secondary-button" type="submit">
            <Search size={18} aria-hidden="true" />
            Znajdź
          </button>
        </div>
        <small>
          Najpierw przeszukujemy adresy zapisanych kontenerów. Geokodowanie
          innych adresów zostanie dodane później.
        </small>
      </form>

      <label className="remember-location">
        <input
          type="checkbox"
          checked={rememberLocation}
          onChange={(event) =>
            changeRememberPreference(event.currentTarget.checked)
          }
        />
        <span>
          <strong>Zapamiętaj ostatnią lokalizację na tym urządzeniu</strong>
          <small>
            Po włączeniu dokładne współrzędne zostaną zapisane tylko w pamięci
            tej przeglądarki. Opcję można wyłączyć w dowolnym momencie.
          </small>
        </span>
      </label>

      {location.status === "ready" ? (
        <div className="message message--success" role="status">
          <strong>
            <ShieldCheck size={16} aria-hidden="true" />
            Lokalizacja gotowa
          </strong>
          <span>{location.label}</span>
          {location.accuracy !== null ? (
            <span>
              Dokładność około {Math.round(location.accuracy).toLocaleString("pl-PL")} m.
            </span>
          ) : null}
          {nearestContainer ? (
            <span className="location-panel__nearest">
              <MapPin size={15} aria-hidden="true" />
              Najbliższy punkt: {nearestContainer.address},{" "}
              {formatDistance(nearestContainer.distanceMeters)}
            </span>
          ) : null}
        </div>
      ) : null}

      {location.status === "error" ? (
        <div className="message message--warning" role="alert">
          <strong>Nie udało się ustawić lokalizacji</strong>
          <span>{location.message}</span>
        </div>
      ) : null}
    </section>
  );
}

function persistLocationIfAllowed(
  location: LocationState,
  rememberLocation: boolean,
): void {
  if (location.status !== "ready") return;

  const currentLocation = {
    ...location.origin,
    accuracy: location.accuracy,
    label: location.label,
    source: location.source,
    savedAt: new Date().toISOString(),
  };

  if (rememberLocation) {
    saveRememberedLocation(currentLocation);
  } else {
    setSessionLocation(currentLocation);
  }
}

function stateFromRememberedLocation(
  location: RememberedLocation,
): LocationState {
  return {
    status: "ready",
    origin: location,
    accuracy: location.accuracy,
    label: location.label,
    source: location.source,
  };
}

function findNearestUniqueContainer(
  records: readonly ContainerRecord[],
  origin: Coordinates,
): (ContainerRecord & { distanceMeters: number }) | null {
  const uniqueRecords = [
    ...new Map(
      records.map((record) => [
        `${record.address}|${record.lat}|${record.lng}`,
        record,
      ]),
    ).values(),
  ];
  const nearest = sortByDistance(uniqueRecords, origin)[0];

  return nearest
    ? {
        ...nearest,
        distanceMeters: calculateDistanceMeters(
          origin.lat,
          origin.lng,
          nearest.lat,
          nearest.lng,
        ),
      }
    : null;
}

function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters).toLocaleString("pl-PL")} m`;
  }

  return `${(distanceMeters / 1_000).toLocaleString("pl-PL", {
    maximumFractionDigits: 1,
  })} km`;
}
