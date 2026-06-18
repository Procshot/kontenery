import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const DATA_PATH = resolve(
  process.argv[2] ?? "public/data/containers.json",
);

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DataFileSchema = z.object({
  generatedAt: z.iso.datetime(),
  containers: z
    .array(
      z.object({
        id: z.string().min(1),
        address: z.string().min(1),
        district: z.string().min(1),
        startDate: IsoDateSchema,
        endDate: IsoDateSchema,
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .min(1, "Plik musi zawierać co najmniej jeden rekord."),
});

async function main(): Promise<void> {
  const raw = await readFile(DATA_PATH, "utf8");
  const parsed = DataFileSchema.parse(JSON.parse(raw));
  const uniqueIds = new Set(parsed.containers.map((record) => record.id));

  if (uniqueIds.size !== parsed.containers.length) {
    throw new Error("Plik danych zawiera zduplikowane identyfikatory.");
  }

  console.log(
    `Walidacja danych zakończona: ${parsed.containers.length.toLocaleString(
      "pl-PL",
    )} rekordów, wersja ${parsed.generatedAt}.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Walidacja danych nie powiodła się: ${message}`);
  process.exitCode = 1;
});
