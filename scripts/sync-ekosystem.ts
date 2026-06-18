import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import * as cheerio from "cheerio";
import XLSX from "xlsx";
import { z } from "zod";

try {
  process.loadEnvFile();
} catch {
  // Plik .env jest opcjonalny; workflow przekazuje ustawienia bezpośrednio.
}

const BASE_URL = "https://gabaryty.ekosystem.wroc.pl";
const TABLE_URL = `${BASE_URL}/tabela-wywozu-odpadow/`;
const DOWNLOADS_URL = `${BASE_URL}/wywoz-odpadow-wielkogabarytowych-tabele/`;
const API_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const OUTPUT_PATH = resolve("public/data/containers.json");
const CACHE_ROOT = resolve(".cache/ekosystem");
const HTTP_CACHE_DIR = join(CACHE_ROOT, "http");
const COORDINATE_CACHE_PATH = join(CACHE_ROOT, "coordinates.json");
const USER_AGENT =
  "wroclaw-containers-data-sync/1.0 (+local PWA data synchronization)";
const CACHE_TTL_MS = Number(
  process.env.EKOSYSTEM_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000,
);
const MAX_CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const REFRESH_CACHE = process.argv.includes("--refresh");

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDate, "Nieprawidłowa data kalendarzowa");

const ContainerSchema = z
  .object({
    id: z.string().min(8),
    address: z.string().min(2),
    district: z.string().min(1),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    lat: z.number().min(50.8).max(51.4),
    lng: z.number().min(16.6).max(17.4),
    sourceMapUrl: z.url(),
    sourcePageUrl: z.url(),
    syncVersion: z.string().min(1),
    syncedAt: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        message: "endDate nie może poprzedzać startDate",
      });
    }
  });

const OutputSchema = z.object({
  generatedAt: z.iso.datetime(),
  source: z.object({
    strategy: z.string(),
    tableUrl: z.url(),
    downloadsUrl: z.url(),
    apiUrl: z.url(),
    excelUrl: z.url().nullable(),
  }),
  containers: z.array(ContainerSchema),
});

const ApiMarkerSchema = z.object({
  point_id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  lat: z.union([z.string(), z.number()]),
  lng: z.union([z.string(), z.number()]),
  estate_id: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) =>
      value === undefined || value === null ? null : String(value),
    ),
  type: z.string().optional().default("Harmonogram"),
  dates: z.string().optional().default(""),
});

const ApiResponseSchema = z.object({
  markers: z.array(ApiMarkerSchema).optional().default([]),
  additionalMarkers: z.array(ApiMarkerSchema).optional().default([]),
});

interface HttpRequestSpec {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

interface HttpCacheMetadata {
  savedAt: string;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  bodyFile: string;
}

interface FetchStats {
  networkRequests: number;
  cacheHits: number;
  staleFallbacks: number;
  retries: number;
}

interface ExcelRow {
  address: string;
  estate: string;
  startDate: string;
}

interface SourceRow {
  address: string;
  estate: string | null;
  estateId: string | null;
  startDate: string;
  lat: number | null;
  lng: number | null;
  pointId: string | null;
  type: string;
  mapUrl: string | null;
  source: "api" | "excel" | "html";
}

interface HtmlParseResult {
  rows: SourceRow[];
  estateById: Map<string, string>;
}

interface CoordinateCacheEntry {
  addressKey: string;
  lat: number;
  lng: number;
  pointId: string | null;
  mapUrl: string;
  lastSeenAt: string;
}

interface CoordinateCacheFile {
  version: 1;
  updatedAt: string;
  entries: Record<string, CoordinateCacheEntry>;
}

interface ExcelParseResult {
  rows: ExcelRow[];
  headers: string[];
  hasCoordinates: boolean;
}

interface SyncReport {
  strategy: string;
  totalRecords: number;
  withoutCoordinates: number;
  dateFrom: string | null;
  dateTo: string | null;
  duplicateCount: number;
  invalidCount: number;
  excelRows: number;
  currentExcelRows: number;
  apiRows: number;
  htmlRows: number;
  apiOnlyRows: number;
  excelOnlyRows: number;
  htmlOnlyRows: number;
  excelHasCoordinates: boolean;
  excelHeaders: string[];
  savedFiles: string[];
}

const fetchStats: FetchStats = {
  networkRequests: 0,
  cacheHits: 0,
  staleFallbacks: 0,
  retries: 0,
};

async function main(): Promise<void> {
  await mkdir(HTTP_CACHE_DIR, { recursive: true });

  const downloadsHtml = (
    await fetchWithCache({ url: DOWNLOADS_URL })
  ).toString("utf8");
  const excelUrl = discoverExcelUrl(downloadsHtml);

  const tasks: Array<() => Promise<Buffer>> = [
    () => fetchWithCache({ url: TABLE_URL }),
    () =>
      fetchWithCache({
        url: API_URL,
        method: "POST",
        body: new URLSearchParams({
          action: "get-points",
          opt1: "false",
          opt2: "false",
          opt3: "true",
          noFit: "0",
          selectedM: "0",
        }).toString(),
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      }),
  ];

  if (excelUrl) {
    tasks.push(() => fetchWithCache({ url: excelUrl }));
  }

  const [tableBuffer, apiBuffer, excelBuffer] = await runWithConcurrency(
    tasks,
    MAX_CONCURRENCY,
  );

  const htmlData = parseTableHtml(tableBuffer.toString("utf8"));
  const apiRows = parseApiResponse(apiBuffer.toString("utf8"));
  const excelData = excelBuffer
    ? parseExcel(excelBuffer)
    : { rows: [], headers: [], hasCoordinates: false };

  const today = getTodayInWarsaw();
  const currentExcelRows = excelData.rows.filter(
    (row) => addDays(row.startDate, 2) >= today,
  );

  const coordinateCache = await loadCoordinateCache();
  updateCoordinateCache(coordinateCache, [...apiRows, ...htmlData.rows]);

  const { rows: mergedRows, duplicateCount, comparison } = mergeSources({
    apiRows,
    excelRows: currentExcelRows,
    htmlRows: htmlData.rows,
    estateById: htmlData.estateById,
    coordinateCache,
  });

  const generatedAt = new Date().toISOString();
  const { containers, invalidCount } = validateAndDeduplicate(
    mergedRows,
    generatedAt,
  );
  if (containers.length === 0) {
    throw new Error(
      "Synchronizacja zwróciła 0 poprawnych rekordów. Poprzedni plik danych pozostaje bez zmian.",
    );
  }
  const strategy = chooseStrategy(apiRows, currentExcelRows, htmlData.rows);

  const output = OutputSchema.parse({
    generatedAt,
    source: {
      strategy,
      tableUrl: TABLE_URL,
      downloadsUrl: DOWNLOADS_URL,
      apiUrl: API_URL,
      excelUrl,
    },
    containers,
  });

  await writeJsonAtomic(OUTPUT_PATH, output);
  await writeJsonAtomic(COORDINATE_CACHE_PATH, coordinateCache);

  const report: SyncReport = {
    strategy,
    totalRecords: containers.length,
    withoutCoordinates: containers.filter(
      (container) => container.lat === null || container.lng === null,
    ).length,
    dateFrom: containers.at(0)?.startDate ?? null,
    dateTo: containers.at(-1)?.startDate ?? null,
    duplicateCount,
    invalidCount,
    excelRows: excelData.rows.length,
    currentExcelRows: currentExcelRows.length,
    apiRows: apiRows.length,
    htmlRows: htmlData.rows.length,
    apiOnlyRows: comparison.apiOnly,
    excelOnlyRows: comparison.excelOnly,
    htmlOnlyRows: comparison.htmlOnly,
    excelHasCoordinates: excelData.hasCoordinates,
    excelHeaders: excelData.headers,
    savedFiles: [OUTPUT_PATH, COORDINATE_CACHE_PATH],
  };

  printReport(report);
}

function discoverExcelUrl(html: string): string | null {
  const $ = cheerio.load(html);
  const candidates = $("a[href]")
    .map((_, element) => $(element).attr("href"))
    .get()
    .filter((href): href is string => Boolean(href))
    .map((href) => new URL(href, DOWNLOADS_URL).href)
    .filter((href) => /\.xlsx(?:$|\?)/i.test(href));

  if (candidates.length === 0) {
    console.warn("Nie znaleziono linku do pliku Excel. Kontynuuję bez niego.");
    return null;
  }

  return candidates.at(-1) ?? null;
}

async function fetchWithCache(spec: HttpRequestSpec): Promise<Buffer> {
  const method = spec.method ?? "GET";
  const cacheKey = createHash("sha256")
    .update(`${method}\n${spec.url}\n${spec.body ?? ""}`)
    .digest("hex");
  const metadataPath = join(HTTP_CACHE_DIR, `${cacheKey}.json`);
  let cachedMetadata: HttpCacheMetadata | null = null;
  let cachedBody: Buffer | null = null;

  try {
    cachedMetadata = JSON.parse(
      await readFile(metadataPath, "utf8"),
    ) as HttpCacheMetadata;
    cachedBody = await readFile(join(HTTP_CACHE_DIR, cachedMetadata.bodyFile));
  } catch {
    cachedMetadata = null;
    cachedBody = null;
  }

  if (
    !REFRESH_CACHE &&
    cachedMetadata &&
    cachedBody &&
    Date.now() - Date.parse(cachedMetadata.savedAt) < CACHE_TTL_MS
  ) {
    fetchStats.cacheHits += 1;
    return cachedBody;
  }

  const headers = new Headers(spec.headers);
  headers.set("accept", "*/*");
  headers.set("user-agent", USER_AGENT);

  if (method === "GET" && cachedMetadata) {
    if (cachedMetadata.etag) {
      headers.set("if-none-match", cachedMetadata.etag);
    }
    if (cachedMetadata.lastModified) {
      headers.set("if-modified-since", cachedMetadata.lastModified);
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      fetchStats.networkRequests += 1;
      const response = await fetch(spec.url, {
        method,
        body: spec.body,
        headers,
        signal: AbortSignal.timeout(60_000),
      });

      if (response.status === 304 && cachedMetadata && cachedBody) {
        cachedMetadata.savedAt = new Date().toISOString();
        await writeJsonAtomic(metadataPath, cachedMetadata);
        fetchStats.cacheHits += 1;
        return cachedBody;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} dla ${spec.url}`);
      }

      const body = Buffer.from(await response.arrayBuffer());
      const extension = cacheExtension(
        response.headers.get("content-type"),
        spec.url,
      );
      const bodyFile = `${cacheKey}${extension}`;
      const metadata: HttpCacheMetadata = {
        savedAt: new Date().toISOString(),
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        contentType: response.headers.get("content-type") ?? undefined,
        bodyFile,
      };

      await writeBufferAtomic(join(HTTP_CACHE_DIR, bodyFile), body);
      await writeJsonAtomic(metadataPath, metadata);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        fetchStats.retries += 1;
        await delay(750 * 2 ** (attempt - 1));
      }
    }
  }

  if (cachedBody) {
    fetchStats.staleFallbacks += 1;
    console.warn(`Używam nieaktualnego cache po błędzie pobierania: ${spec.url}`);
    return cachedBody;
  }

  throw new Error(
    `Nie udało się pobrać ${spec.url}: ${formatError(lastError)}`,
  );
}

function cacheExtension(contentType: string | null, url: string): string {
  if (contentType?.includes("spreadsheetml")) return ".xlsx";
  if (contentType?.includes("json")) return ".json";
  if (contentType?.includes("html")) return ".html";
  return extname(new URL(url).pathname) || ".bin";
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return results;
}

function parseExcel(buffer: Buffer): ExcelParseResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Plik Excel nie zawiera arkusza.");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: null, raw: true },
  );
  const headers = rawRows[0] ? Object.keys(rawRows[0]).map(cleanText) : [];
  const normalizedHeaders = new Map(
    headers.map((header) => [normalizeHeader(header), header]),
  );
  const estateHeader = findHeader(normalizedHeaders, ["osiedle"]);
  const addressHeader = findHeader(normalizedHeaders, ["adres"]);
  const dateHeader = findHeader(normalizedHeaders, [
    "termin realizacji/data podstawienia",
    "data podstawienia",
    "termin realizacji",
  ]);

  if (!estateHeader || !addressHeader || !dateHeader) {
    throw new Error(
      `Nie rozpoznano kolumn Excela. Znalezione nagłówki: ${headers.join(", ")}`,
    );
  }

  const hasCoordinates = headers.some((header) =>
    /^(lat|latitude|lng|lon|longitude|szerokosc geograficzna|dlugosc geograficzna)$/.test(
      normalizeHeader(header),
    ),
  );

  const rows: ExcelRow[] = rawRows.map((rawRow, index) => {
    const normalizedRow = new Map(
      Object.entries(rawRow).map(([key, value]) => [
        normalizeHeader(key),
        value,
      ]),
    );
    const address = cleanText(normalizedRow.get(normalizeHeader(addressHeader)));
    const estate = cleanText(normalizedRow.get(normalizeHeader(estateHeader)));
    const startDate = parseExcelDate(
      normalizedRow.get(normalizeHeader(dateHeader)),
    );

    if (!address || !estate || !startDate) {
      throw new Error(`Nieprawidłowy wiersz Excela nr ${index + 2}.`);
    }

    return { address, estate, startDate };
  });

  return { rows, headers, hasCoordinates };
}

function findHeader(
  headers: Map<string, string>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const header = headers.get(normalizeHeader(candidate));
    if (header) return header;
  }
  return null;
}

function parseExcelDate(value: unknown): string | null {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return toIsoDate(parsed.y, parsed.m, parsed.d);
  }

  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return toIsoDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value === "string") {
    return parseSourceDate(value);
  }

  return null;
}

function parseApiResponse(json: string): SourceRow[] {
  const response = ApiResponseSchema.parse(JSON.parse(json));
  const markers = [...response.markers, ...response.additionalMarkers];
  const rows: SourceRow[] = [];

  for (const marker of markers) {
    const lat = Number(marker.lat);
    const lng = Number(marker.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    for (const rawDate of splitDates(marker.dates)) {
      const startDate = parseSourceDate(rawDate);
      if (!startDate) continue;

      rows.push({
        address: cleanText(marker.title),
        estate: null,
        estateId: marker.estate_id,
        startDate,
        lat,
        lng,
        pointId: marker.point_id,
        type: cleanText(marker.type) || "Harmonogram",
        mapUrl: buildMapUrl(lat, lng, marker.point_id),
        source: "api",
      });
    }
  }

  return rows;
}

function parseTableHtml(html: string): HtmlParseResult {
  const $ = cheerio.load(html);
  const rows: SourceRow[] = [];
  const estateById = new Map<string, string>();

  $("#waste-table .table-inner .table-row").each((_, element) => {
    const cells = $(element).children(".table-cell-4");
    if (cells.length < 4) return;

    const address = cleanText(cells.eq(0).text());
    const estate = cleanText(cells.eq(1).text());
    const rawDates = cleanText(cells.eq(2).text());
    const estateHref = cells.eq(1).find("a[href]").attr("href");
    const mapHref = cells.eq(3).find("a[href]").attr("href");
    const pointId = cleanText($(element).attr("id")) || null;
    const estateId = getSearchParam(estateHref, "estate");
    const coordinates = parseCoordinates(mapHref);

    if (estateId && estate) {
      estateById.set(estateId, estate);
    }

    for (const rawDate of splitDates(rawDates)) {
      const startDate = parseSourceDate(rawDate);
      if (!address || !estate || !startDate) continue;

      rows.push({
        address,
        estate,
        estateId,
        startDate,
        lat: coordinates?.lat ?? null,
        lng: coordinates?.lng ?? null,
        pointId,
        type: "Harmonogram",
        mapUrl: mapHref ? new URL(mapHref, BASE_URL).href : null,
        source: "html",
      });
    }
  });

  if (rows.length === 0) {
    throw new Error("Nie znaleziono rekordów w tabeli HTML.");
  }

  return { rows, estateById };
}

function mergeSources(input: {
  apiRows: SourceRow[];
  excelRows: ExcelRow[];
  htmlRows: SourceRow[];
  estateById: Map<string, string>;
  coordinateCache: CoordinateCacheFile;
}): {
  rows: SourceRow[];
  duplicateCount: number;
  comparison: { apiOnly: number; excelOnly: number; htmlOnly: number };
} {
  const excelByKey = new Map(
    input.excelRows.map((row) => [scheduleKey(row), row]),
  );
  const apiByKey = new Map(input.apiRows.map((row) => [scheduleKey(row), row]));
  const htmlByKey = new Map(
    input.htmlRows.map((row) => [scheduleKey(row), row]),
  );
  const coordinateByAddress = buildCoordinateIndex([
    ...input.apiRows,
    ...input.htmlRows,
  ]);
  const cachedByAddress = buildCachedCoordinateIndex(input.coordinateCache);

  const allKeys =
    input.apiRows.length > 0
      ? new Set(input.apiRows.map(scheduleKey))
      : input.excelRows.length > 0
        ? new Set(input.excelRows.map(scheduleKey))
        : new Set(input.htmlRows.map(scheduleKey));

  if (input.apiRows.length > 0) {
    for (const key of excelByKey.keys()) {
      if (!allKeys.has(key)) allKeys.add(key);
    }
    for (const key of htmlByKey.keys()) {
      if (!allKeys.has(key)) allKeys.add(key);
    }
  }

  let duplicateCount =
    input.apiRows.length + input.excelRows.length + input.htmlRows.length;
  const rows: SourceRow[] = [];

  for (const key of allKeys) {
    const apiRow = apiByKey.get(key);
    const excelRow = excelByKey.get(key);
    const htmlRow = htmlByKey.get(key);
    const preferred = apiRow ?? htmlRow;
    const address = preferred?.address ?? excelRow?.address;
    const startDate = preferred?.startDate ?? excelRow?.startDate;
    if (!address || !startDate) continue;

    const addressKey = normalizeText(address);
    const coordinates =
      preferred && preferred.lat !== null && preferred.lng !== null
        ? preferred
        : coordinateByAddress.get(addressKey) ??
          cachedByAddress.get(addressKey) ??
          null;
    const estate =
      excelRow?.estate ??
      htmlRow?.estate ??
      (apiRow?.estateId
        ? input.estateById.get(apiRow.estateId) ?? null
        : null);

    rows.push({
      address,
      estate,
      estateId: apiRow?.estateId ?? htmlRow?.estateId ?? null,
      startDate,
      lat: coordinates?.lat ?? null,
      lng: coordinates?.lng ?? null,
      pointId:
        apiRow?.pointId ??
        htmlRow?.pointId ??
        coordinates?.pointId ??
        null,
      type: apiRow?.type ?? htmlRow?.type ?? "Harmonogram",
      mapUrl:
        apiRow?.mapUrl ??
        htmlRow?.mapUrl ??
        coordinates?.mapUrl ??
        null,
      source: apiRow ? "api" : excelRow ? "excel" : "html",
    });
  }

  duplicateCount -= rows.length;

  return {
    rows,
    duplicateCount,
    comparison: {
      apiOnly: [...apiByKey.keys()].filter((key) => !excelByKey.has(key)).length,
      excelOnly: [...excelByKey.keys()].filter((key) => !apiByKey.has(key))
        .length,
      htmlOnly: [...htmlByKey.keys()].filter(
        (key) => !apiByKey.has(key) && !excelByKey.has(key),
      ).length,
    },
  };
}

function buildCoordinateIndex(rows: SourceRow[]): Map<string, SourceRow> {
  const grouped = new Map<string, SourceRow[]>();

  for (const row of rows) {
    if (row.lat === null || row.lng === null) continue;
    const key = normalizeText(row.address);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }

  const result = new Map<string, SourceRow>();
  for (const [key, values] of grouped) {
    const uniqueCoordinates = new Set(
      values.map((row) => `${row.lat?.toFixed(7)}|${row.lng?.toFixed(7)}`),
    );
    if (uniqueCoordinates.size === 1) {
      result.set(key, values[0]);
    }
  }
  return result;
}

function validateAndDeduplicate(
  rows: SourceRow[],
  syncedAt: string,
): {
  containers: z.infer<typeof ContainerSchema>[];
  invalidCount: number;
} {
  const containers = new Map<string, z.infer<typeof ContainerSchema>>();
  const errors: string[] = [];

  for (const row of rows) {
    const district = cleanText(row.estate);
    const identity = [
      normalizeText(row.address),
      normalizeText(district),
      row.startDate,
    ].join("|");
    const candidate = {
      id: `eko-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
      address: cleanText(row.address),
      district,
      startDate: row.startDate,
      endDate: addDays(row.startDate, 2),
      lat: row.lat,
      lng: row.lng,
      sourceMapUrl:
        row.mapUrl ??
        (row.lat !== null && row.lng !== null
          ? buildMapUrl(row.lat, row.lng, row.pointId)
          : null),
      sourcePageUrl: TABLE_URL,
      syncVersion: syncedAt,
      syncedAt,
    };
    const parsed = ContainerSchema.safeParse(candidate);

    if (!parsed.success) {
      errors.push(
        `${candidate.address} (${candidate.startDate}): ${z.prettifyError(parsed.error)}`,
      );
      continue;
    }

    containers.set(identity, parsed.data);
  }

  if (errors.length > 0) {
    throw new Error(
      `Walidacja odrzuciła ${errors.length} rekordów:\n${errors
        .slice(0, 10)
        .join("\n")}`,
    );
  }

  return {
    containers: [...containers.values()].sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.address.localeCompare(right.address, "pl"),
    ),
    invalidCount: errors.length,
  };
}

function chooseStrategy(
  apiRows: SourceRow[],
  excelRows: ExcelRow[],
  htmlRows: SourceRow[],
): string {
  if (apiRows.length > 0 && excelRows.length > 0) {
    return "API jako źródło bieżących rekordów i współrzędnych; Excel oraz HTML do uzupełnienia osiedli i kontroli kompletności";
  }
  if (apiRows.length > 0) {
    return "API jako źródło rekordów; HTML jako źródło nazw osiedli";
  }
  if (excelRows.length > 0) {
    return "Excel jako źródło rekordów; HTML i cache jako źródło współrzędnych";
  }
  return "HTML jako źródło awaryjne";
}

async function loadCoordinateCache(): Promise<CoordinateCacheFile> {
  try {
    const parsed = JSON.parse(
      await readFile(COORDINATE_CACHE_PATH, "utf8"),
    ) as CoordinateCacheFile;
    if (parsed.version === 1 && parsed.entries) return parsed;
  } catch {
    // Brak cache przy pierwszym uruchomieniu jest oczekiwany.
  }

  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: {},
  };
}

function updateCoordinateCache(
  cache: CoordinateCacheFile,
  rows: SourceRow[],
): void {
  const now = new Date().toISOString();
  for (const row of rows) {
    if (row.lat === null || row.lng === null) continue;
    const mapUrl = row.mapUrl ?? buildMapUrl(row.lat, row.lng, row.pointId);
    cache.entries[mapUrl] = {
      addressKey: normalizeText(row.address),
      lat: row.lat,
      lng: row.lng,
      pointId: row.pointId,
      mapUrl,
      lastSeenAt: now,
    };
  }
  cache.updatedAt = now;
}

function buildCachedCoordinateIndex(
  cache: CoordinateCacheFile,
): Map<string, CoordinateCacheEntry> {
  const result = new Map<string, CoordinateCacheEntry>();
  const entries = Object.values(cache.entries).sort((left, right) =>
    left.lastSeenAt.localeCompare(right.lastSeenAt),
  );
  for (const entry of entries) {
    result.set(entry.addressKey, entry);
  }
  return result;
}

function getSearchParam(
  href: string | undefined,
  parameter: string,
): string | null {
  if (!href) return null;
  try {
    return new URL(href, BASE_URL).searchParams.get(parameter);
  } catch {
    return null;
  }
}

function parseCoordinates(
  href: string | undefined,
): { lat: number; lng: number } | null {
  if (!href) return null;
  try {
    const url = new URL(href, BASE_URL);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

function buildMapUrl(
  lat: number,
  lng: number,
  pointId: string | null,
): string {
  const url = new URL(BASE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("zoom", "16");
  if (pointId) url.searchParams.set("marker", pointId);
  return url.href;
}

function splitDates(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map(cleanText)
    .filter(Boolean);
}

function parseSourceDate(value: string): string | null {
  const cleaned = cleanText(value);
  const polishMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(cleaned);
  if (polishMatch) {
    return toIsoDate(
      Number(polishMatch[3]),
      Number(polishMatch[2]),
      Number(polishMatch[1]),
    );
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  if (isoMatch) {
    return toIsoDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
  return isRealIsoDate(value) ? value : null;
}

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function getTodayInWarsaw(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function scheduleKey(row: {
  address: string;
  startDate: string;
}): string {
  return `${normalizeText(row.address)}|${row.startDate}`;
}

function normalizeHeader(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeText(value: unknown): string {
  return cleanText(value).toLocaleLowerCase("pl-PL");
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeBufferAtomic(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeBufferAtomic(path: string, value: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, value);
  await rename(temporaryPath, path);
}

function printReport(report: SyncReport): void {
  console.log("\nSynchronizacja Ekosystem zakończona.");
  console.log(`Strategia: ${report.strategy}`);
  console.log(`Rekordy: ${report.totalRecords}`);
  console.log(`Bez współrzędnych: ${report.withoutCoordinates}`);
  console.log(
    `Zakres dat: ${report.dateFrom ?? "brak"} - ${report.dateTo ?? "brak"}`,
  );
  console.log(`Duplikaty/nałożenia źródeł: ${report.duplicateCount}`);
  console.log(`Nieprawidłowe rekordy: ${report.invalidCount}`);
  console.log(
    `Źródła: API ${report.apiRows}, Excel aktywne ${report.currentExcelRows}/${report.excelRows}, HTML ${report.htmlRows}`,
  );
  console.log(
    `Różnice: tylko API ${report.apiOnlyRows}, tylko Excel ${report.excelOnlyRows}, tylko HTML ${report.htmlOnlyRows}`,
  );
  console.log(
    `Excel: współrzędne ${report.excelHasCoordinates ? "tak" : "nie"}; kolumny: ${report.excelHeaders.join(", ")}`,
  );
  console.log(
    `HTTP: sieć ${fetchStats.networkRequests}, cache ${fetchStats.cacheHits}, retry ${fetchStats.retries}, stary cache awaryjny ${fetchStats.staleFallbacks}`,
  );
  console.log("Zapisane pliki:");
  for (const path of report.savedFiles) {
    console.log(`- ${path}`);
  }
}

main().catch((error: unknown) => {
  console.error(`\nSynchronizacja nie powiodła się: ${formatError(error)}`);
  process.exitCode = 1;
});
