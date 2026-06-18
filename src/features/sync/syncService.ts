import { z } from "zod";
import {
  ContainerRecordSchema,
  getAllContainers,
  getSyncMeta,
  replaceContainersSnapshot,
  type ContainerRecord,
  type SyncMeta,
} from "../../db/db";

const DEFAULT_SOURCE_PAGE_URL =
  "https://gabaryty.ekosystem.wroc.pl/tabela-wywozu-odpadow/";
const DATA_URL = `${import.meta.env.BASE_URL}data/containers.json`;

const LegacyContainerSchema = z.object({
  id: z.string().min(1),
  address: z.string().min(1),
  estate: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  lat: z.number(),
  lng: z.number(),
  pointId: z.string().nullable(),
  type: z.string().min(1),
  mapUrl: z.url(),
  source: z.enum(["api", "excel", "html"]),
});

const PayloadSchema = z.object({
  generatedAt: z.iso.datetime(),
  source: z
    .object({
      tableUrl: z.url(),
    })
    .optional(),
  containers: z.array(z.unknown()),
});

export type SyncErrorCode =
  | "offline"
  | "network"
  | "invalid-json"
  | "empty-data"
  | "validation"
  | "storage";

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SyncError";
  }
}

export interface SyncResult {
  importedRecords: number;
  availableRecords: number;
  rejectedRecords: number;
  validationErrors: string[];
  dataVersion: string;
  syncedAt: string;
  source: "network" | "indexeddb";
}

type ContainerParseResult =
  | { success: true; data: ContainerRecord }
  | { success: false; error: z.ZodError };

export async function synchronizeLocalDatabase(): Promise<SyncResult> {
  const source = await fetchNetworkFirstOrUseIndexedDb();
  if (source.type === "indexeddb") {
    return {
      importedRecords: 0,
      availableRecords: source.records.length,
      rejectedRecords: 0,
      validationErrors: [],
      dataVersion: source.meta.dataVersion,
      syncedAt: source.meta.syncedAt,
      source: "indexeddb",
    };
  }

  const payload = await parsePayload(source.response);

  if (payload.containers.length === 0) {
    throw new SyncError("empty-data", "Plik nie zawiera żadnych rekordów.");
  }

  const syncedAt = new Date().toISOString();
  const sourcePageUrl = payload.source?.tableUrl ?? DEFAULT_SOURCE_PAGE_URL;
  const validationErrors: string[] = [];
  const records: ContainerRecord[] = [];
  const recordIds = new Set<string>();

  payload.containers.forEach((source, index) => {
    const parsed = parseContainer(
      source,
      payload.generatedAt,
      syncedAt,
      sourcePageUrl,
    );

    if (!parsed.success) {
      validationErrors.push(
        `Rekord ${index + 1}: ${formatValidationError(parsed.error)}`,
      );
      return;
    }

    if (recordIds.has(parsed.data.id)) {
      validationErrors.push(
        `Rekord ${index + 1}: zduplikowane id „${parsed.data.id}”.`,
      );
      return;
    }

    recordIds.add(parsed.data.id);
    records.push(parsed.data);
  });

  if (records.length === 0) {
    throw new SyncError(
      "validation",
      "Żaden rekord z pliku nie przeszedł walidacji.",
    );
  }

  const dates = records.map((record) => record.startDate).sort();

  try {
    await replaceContainersSnapshot(records, {
      dataVersion: payload.generatedAt,
      syncedAt,
      recordCount: records.length,
      dateMin: dates[0] ?? null,
      dateMax: dates.at(-1) ?? null,
      sourcePageUrl,
    });
  } catch (error) {
    throw new SyncError(
      "storage",
      "Nie udało się zapisać danych w pamięci urządzenia.",
      { cause: error },
    );
  }

  return {
    importedRecords: records.length,
    availableRecords: records.length,
    rejectedRecords: validationErrors.length,
    validationErrors: validationErrors.slice(0, 5),
    dataVersion: payload.generatedAt,
    syncedAt,
    source: "network",
  };
}

type DataSource =
  | { type: "network"; response: Response }
  | { type: "indexeddb"; records: ContainerRecord[]; meta: SyncMeta };

async function fetchNetworkFirstOrUseIndexedDb(): Promise<DataSource> {
  let networkError: unknown;

  if (navigator.onLine) {
    try {
      return { type: "network", response: await fetchSourceData() };
    } catch (error) {
      networkError = error;
    }
  } else {
    networkError = new SyncError(
      "offline",
      "Urządzenie nie ma połączenia z internetem.",
    );
  }

  try {
    const [records, meta] = await Promise.all([
      getAllContainers(),
      getSyncMeta(),
    ]);

    if (records.length > 0 && meta) {
      return { type: "indexeddb", records, meta };
    }
  } catch (error) {
    throw new SyncError(
      "storage",
      "Nie udało się odczytać ostatnich danych z pamięci urządzenia.",
      { cause: error },
    );
  }

  if (networkError instanceof SyncError) throw networkError;
  throw new SyncError("network", "Nie udało się pobrać pliku danych.", {
    cause: networkError,
  });
}

async function fetchSourceData(): Promise<Response> {
  try {
    const response = await fetch(DATA_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new SyncError(
        "network",
        `Serwer zwrócił status ${response.status}.`,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("network", "Nie udało się pobrać pliku danych.", {
      cause: error,
    });
  }
}

async function parsePayload(
  response: Response,
): Promise<z.infer<typeof PayloadSchema>> {
  let json: unknown;

  try {
    json = JSON.parse(await response.text());
  } catch (error) {
    throw new SyncError("invalid-json", "Plik nie jest poprawnym JSON-em.", {
      cause: error,
    });
  }

  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new SyncError(
      "invalid-json",
      `Niepoprawna struktura pliku: ${formatValidationError(parsed.error)}`,
    );
  }

  return parsed.data;
}

function parseContainer(
  source: unknown,
  dataVersion: string,
  syncedAt: string,
  sourcePageUrl: string,
): ContainerParseResult {
  if (isRecord(source) && "district" in source) {
    return ContainerRecordSchema.safeParse({
      ...source,
      syncVersion: dataVersion,
      syncedAt,
    });
  }

  const legacy = LegacyContainerSchema.safeParse(source);
  if (!legacy.success) {
    return { success: false, error: legacy.error };
  }

  return ContainerRecordSchema.safeParse({
    id: legacy.data.id,
    address: legacy.data.address,
    district: legacy.data.estate,
    startDate: legacy.data.startDate,
    endDate: legacy.data.endDate,
    lat: legacy.data.lat,
    lng: legacy.data.lng,
    sourceMapUrl: legacy.data.mapUrl,
    sourcePageUrl,
    syncVersion: dataVersion,
    syncedAt,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValidationError(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "rekord"}: ${issue.message}`)
    .join("; ");
}
