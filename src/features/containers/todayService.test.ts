import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContainerRecord } from "../../db/db";
import {
  buildNavigationUrl,
  filterAndSortTodayContainers,
  formatDaysRemaining,
} from "./todayService";

const records: ContainerRecord[] = [
  createRecord({
    id: "later-near",
    address: "Dębowa 2a",
    district: "Borek",
    startDate: "2026-06-14",
    endDate: "2026-06-16",
    lat: 51.1,
    lng: 17.001,
  }),
  createRecord({
    id: "earlier-far",
    address: "Legnicka 10",
    district: "Szczepin",
    startDate: "2026-06-13",
    endDate: "2026-06-15",
    lat: 51.2,
    lng: 17.2,
  }),
  createRecord({
    id: "inactive",
    address: "Rynek 1",
    district: "Stare Miasto",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    lat: 51.11,
    lng: 17.03,
  }),
];

describe("filterAndSortTodayContainers", () => {
  it("zwraca tylko rekordy aktywne włącznie z datami granicznymi", () => {
    const result = filterAndSortTodayContainers(
      records,
      "2026-06-14",
      null,
      { radius: "all" },
    );

    assert.deepEqual(
      result.map(({ id }) => id),
      ["earlier-far", "later-near"],
    );
    assert.equal(result[0].daysRemaining, 1);
    assert.equal(result[1].daysRemaining, 2);
  });

  it("sortuje po odległości i filtruje promień", () => {
    const result = filterAndSortTodayContainers(
      records,
      "2026-06-14",
      { lat: 51.1, lng: 17 },
      { radius: 1 },
    );

    assert.deepEqual(result.map(({ id }) => id), ["later-near"]);
    assert.ok((result[0].distanceMeters ?? Infinity) < 100);
  });

  it("bez lokalizacji nie crashuje i ignoruje promień", () => {
    const result = filterAndSortTodayContainers(
      records,
      "2026-06-14",
      null,
      { radius: 1 },
    );

    assert.deepEqual(
      result.map(({ id }) => id),
      ["earlier-far", "later-near"],
    );
  });
});

describe("formatowanie widoku", () => {
  it("opisuje ostatni dzień i buduje adres Google Maps", () => {
    assert.equal(formatDaysRemaining(0), "0 dni (ostatni dzień)");

    const url = new URL(buildNavigationUrl(51.1, 17.03));
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/maps/dir/");
    assert.equal(url.searchParams.get("api"), "1");
    assert.equal(url.searchParams.get("destination"), "51.1,17.03");
  });
});

function createRecord(
  values: Partial<ContainerRecord> &
    Pick<
      ContainerRecord,
      "id" | "address" | "district" | "startDate" | "endDate" | "lat" | "lng"
    >,
): ContainerRecord {
  return {
    sourceMapUrl: "https://gabaryty.ekosystem.wroc.pl/",
    sourcePageUrl:
      "https://gabaryty.ekosystem.wroc.pl/tabela-wywozu-odpadow/",
    syncVersion: "test",
    syncedAt: "2026-06-14T12:00:00.000Z",
    ...values,
  };
}
