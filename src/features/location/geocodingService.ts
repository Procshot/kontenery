import { z } from "zod";
import { findAddressMatch, type Coordinates } from "./locationService";

const DEFAULT_NOMINATIM_ENDPOINT =
  "https://nominatim.openstreetmap.org/search";
const GEOCODING_CACHE_KEY = "containers:geocoding-cache:v1";
const CACHE_MAX_ENTRIES = 100;
const CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RATE_LIMIT_MS = 1_100;
const MAX_VISIBLE_RESULTS = 5;

// Przybliżony bounding box służy wyłącznie do odrzucania wyników spoza Wrocławia.
export const WROCLAW_BOUNDS = {
  minLat: 51.03,
  maxLat: 51.22,
  minLng: 16.8,
  maxLng: 17.2,
} as const;

export interface GeocodeResult extends Coordinates {
  label: string;
  district?: string;
  provider: "local" | "nominatim" | "other";
  raw?: unknown;
}

export type GeocodingErrorCode =
  | "offline"
  | "timeout"
  | "no-results"
  | "outside-wroclaw"
  | "ambiguous"
  | "api";

export class GeocodingError extends Error {
  constructor(
    readonly code: GeocodingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GeocodingError";
  }
}

export interface GeocodingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GeocodingOptions {
  endpoint?: string;
  fetchFn?: typeof fetch;
  isOnline?: boolean;
  now?: () => number;
  rateLimitMs?: number;
  storage?: GeocodingStorage | null;
  timeoutMs?: number;
}

interface LocalAddressRecord extends Coordinates {
  address: string;
  district?: string;
}

const NominatimResultSchema = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string().min(1),
  importance: z.number().optional().default(0),
  address: z.record(z.string(), z.unknown()).optional().default({}),
});

const CacheResultSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().min(1),
  district: z.string().optional(),
  provider: z.enum(["nominatim", "other"]),
});

const CacheEntrySchema = z.object({
  key: z.string().min(1),
  timestamp: z.number().nonnegative(),
  results: z.array(CacheResultSchema).min(1).max(MAX_VISIBLE_RESULTS),
});

const CacheSchema = z.array(CacheEntrySchema).max(CACHE_MAX_ENTRIES);

let lastNetworkRequestAt = 0;

export async function resolveAddressInWroclaw(
  records: readonly LocalAddressRecord[],
  query: string,
  options: GeocodingOptions = {},
): Promise<GeocodeResult[]> {
  const normalizedQuery = cleanQuery(query);
  const localMatch = hasAddressNumber(normalizedQuery)
    ? findAddressMatch(records, normalizedQuery)
    : null;

  if (localMatch && isPointInsideWroclawBounds(localMatch.lat, localMatch.lng)) {
    return [
      {
        lat: localMatch.lat,
        lng: localMatch.lng,
        label: localMatch.address,
        district: localMatch.district,
        provider: "local",
      },
    ];
  }

  return geocodeAddressInWroclaw(normalizedQuery, options);
}

export async function geocodeAddressInWroclaw(
  query: string,
  options: GeocodingOptions = {},
): Promise<GeocodeResult[]> {
  const normalizedQuery = normalizeWroclawAddressQuery(query);
  const cacheKey = normalizeCacheKey(normalizedQuery);
  const storage = options.storage === undefined
    ? getLocalStorage()
    : options.storage;
  const now = options.now ?? Date.now;
  const cachedResults = readCachedResults(storage, cacheKey, now());

  if (cachedResults) return cachedResults;

  const isOnline = options.isOnline ?? getOnlineStatus();
  if (!isOnline) {
    throw new GeocodingError(
      "offline",
      "Geokodowanie nowego adresu wymaga internetu. Możesz użyć GPS albo wcześniej zapisanej lokalizacji.",
    );
  }

  const endpoint =
    options.endpoint ??
    import.meta.env?.VITE_GEOCODING_URL ??
    DEFAULT_NOMINATIM_ENDPOINT;
  const fetchFn = options.fetchFn ?? fetch;
  const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
  await waitForRateLimit(rateLimitMs, now);

  const url = new URL(endpoint);
  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "pl");
  url.searchParams.set("countrycodes", "pl");
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "viewbox",
    `${WROCLAW_BOUNDS.minLng},${WROCLAW_BOUNDS.maxLat},${WROCLAW_BOUNDS.maxLng},${WROCLAW_BOUNDS.minLat}`,
  );
  url.searchParams.set("bounded", "1");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    lastNetworkRequestAt = now();
    response = await fetchFn(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new GeocodingError(
        "timeout",
        "Wyszukiwanie adresu trwało zbyt długo. Spróbuj ponownie.",
        { cause: error },
      );
    }
    throw new GeocodingError(
      "api",
      "Nie udało się połączyć z usługą wyszukiwania adresów. Poprzednia lokalizacja pozostaje bez zmian.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new GeocodingError(
      "api",
      `Usługa wyszukiwania adresów zwróciła błąd ${response.status}. Spróbuj ponownie później.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new GeocodingError(
      "api",
      "Usługa wyszukiwania adresów zwróciła niepoprawną odpowiedź.",
      { cause: error },
    );
  }

  const parsed = z.array(NominatimResultSchema).safeParse(payload);
  if (!parsed.success) {
    throw new GeocodingError(
      "api",
      "Usługa wyszukiwania adresów zwróciła niepoprawną odpowiedź.",
      { cause: parsed.error },
    );
  }

  if (parsed.data.length === 0) {
    throw new GeocodingError(
      "no-results",
      "Nie znaleziono tego adresu we Wrocławiu. Spróbuj wpisać ulicę z numerem, np. Grabiszyńska 150.",
    );
  }

  const results = parsed.data
    .filter(isNominatimResultInWroclaw)
    .map(toGeocodeResult)
    .filter((result): result is GeocodeResult => result !== null)
    .filter((result) => isPointInsideWroclawBounds(result.lat, result.lng));

  if (results.length === 0) {
    throw new GeocodingError(
      "outside-wroclaw",
      "Znaleziony adres znajduje się poza Wrocławiem. Wpisz adres w granicach miasta.",
    );
  }

  const ranked = rankGeocodeResults(results, query);
  if (ranked.length > MAX_VISIBLE_RESULTS) {
    throw new GeocodingError(
      "ambiguous",
      "Znaleziono zbyt wiele podobnych miejsc. Dopisz numer budynku lub dokładniejszą nazwę ulicy.",
    );
  }

  writeCachedResults(storage, cacheKey, ranked, now());
  return ranked;
}

export function normalizeWroclawAddressQuery(query: string): string {
  const parts = [cleanQuery(query)];
  const normalized = normalizeForComparison(query);

  if (!normalized.includes("wroclaw")) parts.push("Wrocław");
  if (!normalized.includes("polska") && !normalized.includes("poland")) {
    parts.push("Polska");
  }

  return parts.join(", ");
}

export function isPointInsideWroclawBounds(
  lat: number,
  lng: number,
): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= WROCLAW_BOUNDS.minLat &&
    lat <= WROCLAW_BOUNDS.maxLat &&
    lng >= WROCLAW_BOUNDS.minLng &&
    lng <= WROCLAW_BOUNDS.maxLng
  );
}

export function rankGeocodeResults(
  results: GeocodeResult[],
  originalQuery: string,
): GeocodeResult[] {
  const query = normalizeForComparison(originalQuery);
  const queryTokens = query.split(" ").filter(Boolean);

  return [...deduplicateResults(results)]
    .map((result, index) => {
      const label = normalizeForComparison(result.label);
      const matchingTokens = queryTokens.filter((token) =>
        label.includes(token),
      ).length;
      const tokenScore = matchingTokens / Math.max(queryTokens.length, 1);
      const importance = getRawImportance(result.raw);
      const score =
        (label.startsWith(query) ? 2 : 0) +
        tokenScore +
        importance +
        (result.provider === "local" ? 3 : 0);
      return { result, index, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.index - right.index ||
        left.result.label.localeCompare(right.result.label, "pl"),
    )
    .map(({ result }) => result);
}

function toGeocodeResult(
  value: z.infer<typeof NominatimResultSchema>,
): GeocodeResult | null {
  const lat = Number(value.lat);
  const lng = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = value.address;
  const road = firstString(
    address.road,
    address.pedestrian,
    address.residential,
    address.square,
    address.place,
  );
  const houseNumber = firstString(address.house_number);
  const district = firstString(
    address.suburb,
    address.city_district,
    address.neighbourhood,
    address.quarter,
  );
  const streetAddress = [road, houseNumber].filter(Boolean).join(" ");
  const label = streetAddress
    ? `${streetAddress}, Wrocław`
    : value.display_name;

  return {
    lat,
    lng,
    label,
    district,
    provider: "nominatim",
    raw: value,
  };
}

function readCachedResults(
  storage: GeocodingStorage | null,
  key: string,
  now: number,
): GeocodeResult[] | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(GEOCODING_CACHE_KEY);
    if (!raw) return null;
    const parsed = CacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      storage.removeItem(GEOCODING_CACHE_KEY);
      return null;
    }

    const entry = parsed.data.find((candidate) => candidate.key === key);
    if (!entry || now - entry.timestamp > CACHE_MAX_AGE_MS) return null;
    return entry.results;
  } catch {
    return null;
  }
}

function writeCachedResults(
  storage: GeocodingStorage | null,
  key: string,
  results: GeocodeResult[],
  timestamp: number,
): void {
  if (!storage) return;

  try {
    const currentRaw = storage.getItem(GEOCODING_CACHE_KEY);
    const currentParsed = currentRaw
      ? CacheSchema.safeParse(JSON.parse(currentRaw))
      : null;
    const current = currentParsed?.success ? currentParsed.data : [];
    const safeResults = results.map(({ lat, lng, label, district, provider }) => ({
      lat,
      lng,
      label,
      district,
      provider: provider === "local" ? "other" as const : provider,
    }));
    const next = [
      { key, timestamp, results: safeResults },
      ...current.filter((entry) => entry.key !== key),
    ].slice(0, CACHE_MAX_ENTRIES);

    storage.setItem(GEOCODING_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Cache jest optymalizacją i nie może blokować ustawienia lokalizacji.
  }
}

function deduplicateResults(results: GeocodeResult[]): GeocodeResult[] {
  const unique = new Map<string, GeocodeResult>();
  for (const result of results) {
    const key = canonicalAddressKey(result.label);
    if (!unique.has(key)) unique.set(key, result);
  }
  return [...unique.values()];
}

function canonicalAddressKey(label: string): string {
  return normalizeForComparison(label)
    .replace(/^(?:ulica|ul|aleja|al|plac|pl)\s+/, "")
    .replace(/\s+wroclaw(?:\s+polska)?$/, "");
}

async function waitForRateLimit(
  rateLimitMs: number,
  now: () => number,
): Promise<void> {
  const waitMs = Math.max(0, lastNetworkRequestAt + rateLimitMs - now());
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function cleanQuery(query: string): string {
  return query.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeCacheKey(query: string): string {
  return normalizeForComparison(query);
}

function normalizeForComparison(value: string): string {
  return value
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pl")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasAddressNumber(query: string): boolean {
  return /\b\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\b/i.test(query);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
}

function isNominatimResultInWroclaw(
  value: z.infer<typeof NominatimResultSchema>,
): boolean {
  const localities = [
    value.address.city,
    value.address.town,
    value.address.municipality,
  ].filter((locality): locality is string => typeof locality === "string");

  return localities.some((locality) => {
    const normalized = normalizeForComparison(locality);
    return normalized === "wroclaw" || normalized === "gmina wroclaw";
  });
}

function getRawImportance(raw: unknown): number {
  if (!raw || typeof raw !== "object" || !("importance" in raw)) return 0;
  const importance = Number((raw as { importance?: unknown }).importance);
  return Number.isFinite(importance) ? importance : 0;
}

function getOnlineStatus(): boolean {
  return typeof window === "undefined" || typeof navigator === "undefined"
    ? true
    : navigator.onLine;
}

function getLocalStorage(): GeocodingStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
