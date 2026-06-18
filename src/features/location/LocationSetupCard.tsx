import { Crosshair, LocateFixed, Search, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getAllContainers } from "../../db/db";
import {
  resolveAddressInWroclaw,
  type GeocodeResult,
} from "./geocodingService";
import { getCurrentPosition } from "./locationService";
import {
  setLocationSaved,
  setUserLocation,
  useUserLocation,
} from "./locationStore";

export function LocationSetupCard() {
  const location = useUserLocation();
  const records = useLiveQuery(() => getAllContainers(), [], []);
  const [rememberLocation, setRememberLocation] = useState(
    () => location?.saved ?? false,
  );
  const [address, setAddress] = useState(
    () => (location?.source === "address" ? location.label : ""),
  );
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [candidates, setCandidates] = useState<GeocodeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function requestDeviceLocation() {
    setIsLocating(true);
    setError(null);

    try {
      const currentPosition = await getCurrentPosition();
      setCandidates([]);
      setUserLocation(
        {
          lat: currentPosition.lat,
          lng: currentPosition.lng,
          accuracy: currentPosition.accuracy,
          label: "lokalizacja urządzenia",
          source: "device",
        },
        rememberLocation,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Nie udało się pobrać lokalizacji.",
      );
    } finally {
      setIsLocating(false);
    }
  }

  async function searchAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSearching) return;

    setIsSearching(true);
    setError(null);
    setCandidates([]);

    try {
      const results = await resolveAddressInWroclaw(records, address);
      if (results.length === 1) {
        selectAddress(results[0]);
      } else {
        setCandidates(results);
      }
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Nie udało się wyszukać adresu. Poprzednia lokalizacja pozostaje bez zmian.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  function selectAddress(result: GeocodeResult) {
    setAddress(result.label);
    setCandidates([]);
    setError(null);
    setUserLocation(
      {
        lat: result.lat,
        lng: result.lng,
        accuracy: null,
        label: result.label,
        source: "address",
      },
      rememberLocation,
    );
  }

  function changeRememberPreference(checked: boolean) {
    setRememberLocation(checked);
    setLocationSaved(checked);
  }

  return (
    <section className="panel location-panel location-setup-card">
      <div className="panel__title">
        <LocateFixed size={21} aria-hidden="true" />
        <h2>Twoja lokalizacja</h2>
      </div>
      <p>
        Użyj lokalizacji telefonu albo wpisz adres we Wrocławiu. Ta lokalizacja
        będzie używana w zakładkach Dzisiaj, Następne i Mapa.
      </p>

      <button
        className="secondary-button location-panel__gps"
        type="button"
        onClick={() => void requestDeviceLocation()}
        disabled={isLocating || isSearching}
      >
        <Crosshair size={18} aria-hidden="true" />
        {isLocating
          ? "Pobieranie lokalizacji..."
          : "Użyj lokalizacji telefonu"}
      </button>

      <div className="location-panel__divider">
        <span>lub wpisz adres</span>
      </div>

      <form
        className="address-search"
        onSubmit={(event) => void searchAddress(event)}
        aria-busy={isSearching}
      >
        <label htmlFor="location-address">Wpisz adres we Wrocławiu</label>
        <div className="address-search__controls">
          <input
            id="location-address"
            type="search"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setCandidates([]);
            }}
            placeholder="np. Dębowa 2a, Grabiszyńska 150"
            autoComplete="street-address"
            minLength={3}
            disabled={isSearching || isLocating}
            required
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={isSearching || isLocating || address.trim().length < 3}
          >
            <Search size={18} aria-hidden="true" />
            {isSearching ? "Szukanie..." : "Znajdź"}
          </button>
        </div>
        <small>
          Adres służy tylko do ustawienia Twojej lokalizacji i liczenia
          odległości do kontenerów.
        </small>
        <small>
          Wpisany adres może zostać użyty do jednorazowego wyszukania
          współrzędnych online. Lokalizacja GPS nie jest wysyłana na serwer.
        </small>
      </form>

      {candidates.length > 1 ? (
        <div className="geocode-results" aria-live="polite">
          <strong>Wybierz właściwy adres</strong>
          <div className="geocode-results__list">
            {candidates.map((candidate) => (
              <article
                className="geocode-result"
                key={`${candidate.lat}-${candidate.lng}-${candidate.label}`}
              >
                <span>
                  <strong>{candidate.label}</strong>
                  {candidate.district ? <small>{candidate.district}</small> : null}
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => selectAddress(candidate)}
                >
                  Wybierz
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <small className="geocoding-attribution">
        Wyniki geokodowania: {" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </small>

      <label className="remember-location">
        <input
          type="checkbox"
          checked={rememberLocation}
          onChange={(event) =>
            changeRememberPreference(event.currentTarget.checked)
          }
        />
        <span>
          <strong>Zapamiętaj lokalizację na tym urządzeniu</strong>
          <small>
            Współrzędne zostaną zapisane wyłącznie w tej przeglądarce.
          </small>
        </span>
      </label>

      {location ? (
        <div className="message message--success" role="status">
          <strong>
            <ShieldCheck size={16} aria-hidden="true" />
            Ustawiono lokalizację: {location.label}
          </strong>
          {location.accuracy !== null ? (
            <span>
              Dokładność około{" "}
              {Math.round(location.accuracy).toLocaleString("pl-PL")} m.
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="message message--warning" role="alert">
          <strong>Nie udało się ustawić lokalizacji</strong>
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  );
}
