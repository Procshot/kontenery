const EARTH_RADIUS_METERS = 6_371_000;

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CurrentPosition extends Coordinates {
  accuracy: number;
  capturedAt: string;
}

export type LocationErrorCode =
  | "permission-denied"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "unknown";

export class LocationError extends Error {
  constructor(
    readonly code: LocationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocationError";
  }
}

export function getCurrentPosition(): Promise<CurrentPosition> {
  if (
    typeof navigator === "undefined" ||
    !("geolocation" in navigator) ||
    !navigator.geolocation
  ) {
    return Promise.reject(
      new LocationError(
        "unsupported",
        "Ta przeglądarka nie obsługuje geolokalizacji.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        resolve({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          capturedAt: new Date(timestamp || Date.now()).toISOString(),
        });
      },
      (error) => reject(mapGeolocationError(error)),
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 300_000,
      },
    );
  });
}

export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  assertCoordinates({ lat: lat1, lng: lng1 });
  assertCoordinates({ lat: lat2, lng: lng2 });

  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lng2 - lng1);
  const startLatitude = toRadians(lat1);
  const endLatitude = toRadians(lat2);

  const haversineValue =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const haversine = Math.min(1, Math.max(0, haversineValue));

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function sortByDistance<T extends Coordinates>(
  records: readonly T[],
  origin: Coordinates,
): T[] {
  assertCoordinates(origin);

  return records
    .map((record, index) => ({
      record,
      index,
      distance: calculateDistanceMeters(
        origin.lat,
        origin.lng,
        record.lat,
        record.lng,
      ),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.index - right.index,
    )
    .map(({ record }) => record);
}

export function findAddressMatch<T extends Coordinates & { address: string }>(
  records: readonly T[],
  query: string,
): T | null {
  const normalizedQuery = normalizeAddress(query);
  if (normalizedQuery.length < 3) return null;
  const queryNumberTokens = getAddressNumberTokens(normalizedQuery);

  const matches = records
    .map((record) => {
      const normalizedAddress = normalizeAddress(record.address);
      const addressNumberTokens = getAddressNumberTokens(normalizedAddress);
      const hasMatchingNumber = queryNumberTokens.every((token) =>
        addressNumberTokens.includes(token),
      );

      return {
        record,
        score: hasMatchingNumber
          ? calculateAddressScore(normalizedAddress, normalizedQuery)
          : 0,
      };
    })
    .filter(({ score }) => score >= 0.55)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.record.address.localeCompare(right.record.address, "pl"),
    );

  return matches[0]?.record ?? null;
}

function mapGeolocationError(error: GeolocationPositionError): LocationError {
  switch (error.code) {
    case 1:
      return new LocationError(
        "permission-denied",
        "Nie przyznano dostępu do lokalizacji. Możesz wpisać adres ręcznie.",
        { cause: error },
      );
    case 2:
      return new LocationError(
        "unavailable",
        "Lokalizacja jest obecnie niedostępna. Spróbuj ponownie później.",
        { cause: error },
      );
    case 3:
      return new LocationError(
        "timeout",
        "Przekroczono czas oczekiwania na lokalizację.",
        { cause: error },
      );
    default:
      return new LocationError(
        "unknown",
        "Nie udało się pobrać lokalizacji.",
        { cause: error },
      );
  }
}

function calculateAddressScore(address: string, query: string): number {
  if (address === query) return 1;
  if (address.startsWith(query) || query.startsWith(address)) return 0.9;
  if (address.includes(query) || query.includes(address)) return 0.8;

  const addressTokens = new Set(address.split(" "));
  const queryTokens = new Set(query.split(" "));
  const commonTokens = [...queryTokens].filter((token) =>
    addressTokens.has(token),
  ).length;
  const tokenScore =
    commonTokens / Math.max(addressTokens.size, queryTokens.size, 1);
  const editScore =
    1 -
    levenshteinDistance(address, query) /
      Math.max(address.length, query.length, 1);

  return Math.max(tokenScore, editScore);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function normalizeAddress(value: string): string {
  return value
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pl")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getAddressNumberTokens(value: string): string[] {
  return value
    .split(" ")
    .filter((token) => /^\d+[a-z]?$/.test(token));
}

function assertCoordinates(coordinates: Coordinates): void {
  if (
    !Number.isFinite(coordinates.lat) ||
    !Number.isFinite(coordinates.lng) ||
    coordinates.lat < -90 ||
    coordinates.lat > 90 ||
    coordinates.lng < -180 ||
    coordinates.lng > 180
  ) {
    throw new RangeError("Nieprawidłowe współrzędne geograficzne.");
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
