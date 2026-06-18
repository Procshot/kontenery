import Dexie, { type Table, type Transaction } from "dexie";
import { z } from "zod";

const DATABASE_NAME = "wroclaw-containers";
const SYNC_META_ID = "current";
const SOURCE_PAGE_URL =
  "https://gabaryty.ekosystem.wroc.pl/tabela-wywozu-odpadow/";

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDate, "Nieprawidłowa data kalendarzowa");

export const ContainerRecordSchema = z
  .object({
    id: z.string().min(1),
    address: z.string().min(1),
    district: z.string().min(1),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    sourceMapUrl: z.url(),
    sourcePageUrl: z.url(),
    syncVersion: z.string().min(1),
    syncedAt: z.iso.datetime(),
  })
  .superRefine((record, context) => {
    if (record.endDate < record.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "endDate nie może poprzedzać startDate",
      });
    }
  });

export const SyncMetaSchema = z
  .object({
    id: z.literal(SYNC_META_ID),
    dataVersion: z.string().min(1),
    syncedAt: z.iso.datetime(),
    recordCount: z.number().int().nonnegative(),
    dateMin: IsoDateSchema.nullable(),
    dateMax: IsoDateSchema.nullable(),
    sourcePageUrl: z.url(),
  })
  .superRefine((meta, context) => {
    if (meta.dateMin && meta.dateMax && meta.dateMax < meta.dateMin) {
      context.addIssue({
        code: "custom",
        path: ["dateMax"],
        message: "dateMax nie może poprzedzać dateMin",
      });
    }
  });

export type ContainerRecord = z.infer<typeof ContainerRecordSchema>;
export type SyncMeta = z.infer<typeof SyncMetaSchema>;
export type SyncMetaInput = Omit<SyncMeta, "id">;

interface LegacyContainerRecord {
  id?: unknown;
  address?: unknown;
  estate?: unknown;
  district?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  lat?: unknown;
  lng?: unknown;
  mapUrl?: unknown;
  sourceMapUrl?: unknown;
  sourcePageUrl?: unknown;
  syncVersion?: unknown;
  syncedAt?: unknown;
}

interface LegacySyncMetaRecord {
  id?: unknown;
  syncVersion?: unknown;
  dataVersion?: unknown;
  syncedAt?: unknown;
  recordCount?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  dateMin?: unknown;
  dateMax?: unknown;
  sourcePageUrl?: unknown;
}

class ContainersDatabase extends Dexie {
  containers!: Table<ContainerRecord, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super(DATABASE_NAME);

    // Wersja 1 odpowiada bazie używanej przez wcześniejszy szkielet aplikacji.
    this.version(1).stores({
      containers: "id,startDate,endDate,estate,address,pointId,type",
      meta: "key",
    });

    this.version(2)
      .stores({
        containers: "id,startDate,endDate,district,address,syncVersion",
        syncMeta: "id,syncedAt,syncVersion",
        meta: null,
      })
      .upgrade(async (transaction) => {
        await migrateLegacyContainers(transaction);
      });

    this.version(3)
      .stores({
        containers: "id,startDate,endDate,district,address,syncVersion",
        syncMeta: "id,syncedAt,dataVersion",
      })
      .upgrade(async (transaction) => {
        await migrateSyncMeta(transaction);
      });
  }
}

export const db = new ContainersDatabase();

export class IndexedDbError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`Błąd IndexedDB podczas operacji „${operation}”: ${errorMessage(cause)}`);
    this.name = "IndexedDbError";
    this.operation = operation;
    this.cause = cause;
  }
}

export class ContainerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerValidationError";
  }
}

export async function clearContainers(): Promise<void> {
  await runDbOperation("czyszczenie kontenerów", () => db.containers.clear());
}

export async function bulkUpsertContainers(
  records: ContainerRecord[],
): Promise<void> {
  const validatedRecords = validateContainerRecords(records);
  await runDbOperation("zapis kontenerów", () =>
    db.containers.bulkPut(validatedRecords),
  );
}

export async function getAllContainers(): Promise<ContainerRecord[]> {
  return runDbOperation("odczyt wszystkich kontenerów", () =>
    db.containers.orderBy("startDate").toArray(),
  );
}

export async function getActiveContainers(
  today: string,
): Promise<ContainerRecord[]> {
  const normalizedToday = validateQueryDate(today);

  return runDbOperation("odczyt aktywnych kontenerów", async () => {
    const records = await db.containers
      .where("startDate")
      .belowOrEqual(normalizedToday)
      .and((record) => record.endDate >= normalizedToday)
      .toArray();

    return sortByAddress(records);
  });
}

export async function getUpcomingContainers(
  today: string,
  daysAhead: number,
): Promise<ContainerRecord[]> {
  const normalizedToday = validateQueryDate(today);
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 366) {
    throw new ContainerValidationError(
      "daysAhead musi być liczbą całkowitą od 0 do 366.",
    );
  }

  const lastDate = addDays(normalizedToday, daysAhead);
  return runDbOperation("odczyt nadchodzących kontenerów", () =>
    db.containers
      .where("startDate")
      .between(normalizedToday, lastDate, false, true)
      .sortBy("startDate"),
  );
}

export async function getSyncMeta(): Promise<SyncMeta | null> {
  return runDbOperation("odczyt metadanych synchronizacji", async () => {
    const meta = await db.syncMeta.get(SYNC_META_ID);
    return meta ? SyncMetaSchema.parse(meta) : null;
  });
}

export async function setSyncMeta(meta: SyncMetaInput): Promise<void> {
  const validatedMeta = validateSyncMeta(meta);
  await runDbOperation("zapis metadanych synchronizacji", () =>
    db.syncMeta.put(validatedMeta),
  );
}

export async function replaceContainersSnapshot(
  records: ContainerRecord[],
  meta: SyncMetaInput,
): Promise<void> {
  const validatedRecords = validateContainerRecords(records);
  const validatedMeta = validateSyncMeta({
    ...meta,
    recordCount: validatedRecords.length,
  });

  await runDbOperation("atomowa wymiana danych", () =>
    db.transaction("rw", db.containers, db.syncMeta, async () => {
      await db.containers.clear();
      await db.containers.bulkPut(validatedRecords);
      await db.syncMeta.put(validatedMeta);
    }),
  );
}

function validateContainerRecords(records: ContainerRecord[]): ContainerRecord[] {
  if (!Array.isArray(records)) {
    throw new ContainerValidationError("Lista kontenerów nie jest tablicą.");
  }

  return records.map((record, index) => {
    const result = ContainerRecordSchema.safeParse(record);
    if (!result.success) {
      throw new ContainerValidationError(
        `Nieprawidłowy rekord kontenera nr ${index + 1}: ${formatZodError(
          result.error,
        )}`,
      );
    }
    return result.data;
  });
}

function validateSyncMeta(meta: SyncMetaInput): SyncMeta {
  const result = SyncMetaSchema.safeParse({ id: SYNC_META_ID, ...meta });
  if (!result.success) {
    throw new ContainerValidationError(
      `Nieprawidłowe metadane synchronizacji: ${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

async function migrateLegacyContainers(
  transaction: Transaction,
): Promise<void> {
  const table = transaction.table<LegacyContainerRecord, string>("containers");
  const legacyRecords = await table.toArray();
  if (legacyRecords.length === 0) return;

  const migrationTimestamp = new Date().toISOString();
  const migratedRecords = legacyRecords.flatMap((record) => {
    const migrated = migrateLegacyRecord(record, migrationTimestamp);
    const result = ContainerRecordSchema.safeParse(migrated);
    return result.success ? [result.data] : [];
  });

  await table.clear();
  if (migratedRecords.length > 0) {
    await transaction.table("containers").bulkPut(migratedRecords);
  }

  const dateRange = calculateDateRange(migratedRecords);
  await transaction.table("syncMeta").put({
    id: SYNC_META_ID,
    syncVersion: "legacy-v1-migration",
    syncedAt: migrationTimestamp,
    recordCount: migratedRecords.length,
    dateFrom: dateRange.dateMin,
    dateTo: dateRange.dateMax,
    sourcePageUrl: SOURCE_PAGE_URL,
  });
}

async function migrateSyncMeta(transaction: Transaction): Promise<void> {
  const metaTable = transaction.table<LegacySyncMetaRecord, string>("syncMeta");
  const previousMeta = await metaTable.get(SYNC_META_ID);
  const records = await transaction
    .table<ContainerRecord, string>("containers")
    .toArray();

  if (!previousMeta && records.length === 0) return;

  const dateRange = calculateDateRange(records);
  const migrationTimestamp = new Date().toISOString();
  const migratedMeta = SyncMetaSchema.parse({
    id: SYNC_META_ID,
    dataVersion:
      cleanText(previousMeta?.dataVersion) ||
      cleanText(previousMeta?.syncVersion) ||
      "legacy-v2-migration",
    syncedAt: isIsoDateTime(previousMeta?.syncedAt)
      ? String(previousMeta?.syncedAt)
      : migrationTimestamp,
    recordCount: records.length,
    dateMin:
      cleanNullableDate(previousMeta?.dateMin) ??
      cleanNullableDate(previousMeta?.dateFrom) ??
      dateRange.dateMin,
    dateMax:
      cleanNullableDate(previousMeta?.dateMax) ??
      cleanNullableDate(previousMeta?.dateTo) ??
      dateRange.dateMax,
    sourcePageUrl:
      cleanText(previousMeta?.sourcePageUrl) || SOURCE_PAGE_URL,
  });

  await metaTable.put(migratedMeta);
}

function migrateLegacyRecord(
  record: LegacyContainerRecord,
  migrationTimestamp: string,
): ContainerRecord {
  const lat = Number(record.lat);
  const lng = Number(record.lng);
  const id = cleanText(record.id);
  const sourceMapUrl =
    cleanText(record.sourceMapUrl) ||
    cleanText(record.mapUrl) ||
    buildSourceMapUrl(lat, lng);

  return {
    id,
    address: cleanText(record.address),
    district: cleanText(record.district) || cleanText(record.estate),
    startDate: cleanText(record.startDate),
    endDate: cleanText(record.endDate),
    lat,
    lng,
    sourceMapUrl,
    sourcePageUrl: cleanText(record.sourcePageUrl) || SOURCE_PAGE_URL,
    syncVersion: cleanText(record.syncVersion) || "legacy-v1",
    syncedAt: isIsoDateTime(record.syncedAt)
      ? String(record.syncedAt)
      : migrationTimestamp,
  };
}

function buildSourceMapUrl(lat: number, lng: number): string {
  const url = new URL("https://gabaryty.ekosystem.wroc.pl/");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("zoom", "16");
  return url.href;
}

function calculateDateRange(records: ContainerRecord[]): {
  dateMin: string | null;
  dateMax: string | null;
} {
  if (records.length === 0) return { dateMin: null, dateMax: null };
  const dates = records.map((record) => record.startDate).sort();
  return {
    dateMin: dates[0] ?? null,
    dateMax: dates.at(-1) ?? null,
  };
}

function validateQueryDate(value: string): string {
  const result = IsoDateSchema.safeParse(value);
  if (!result.success) {
    throw new ContainerValidationError(`Nieprawidłowa data zapytania: ${value}`);
  }
  return result.data;
}

async function runDbOperation<T>(
  operation: string,
  callback: () => Promise<T>,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (
      error instanceof IndexedDbError ||
      error instanceof ContainerValidationError
    ) {
      throw error;
    }
    throw new IndexedDbError(operation, error);
  }
}

function sortByAddress(records: ContainerRecord[]): ContainerRecord[] {
  return records.sort((left, right) =>
    left.address.localeCompare(right.address, "pl"),
  );
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
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

function isIsoDateTime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    z.iso.datetime().safeParse(value).success
  );
}

function cleanText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function cleanNullableDate(value: unknown): string | null {
  const result = IsoDateSchema.safeParse(cleanText(value));
  return result.success ? result.data : null;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "rekord"}: ${issue.message}`)
    .join("; ");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
