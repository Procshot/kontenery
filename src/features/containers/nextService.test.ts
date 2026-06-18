import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContainerRecord } from "../../db/db";
import {
  formatUpcomingDateLabel,
  groupUpcomingContainers,
} from "./nextService";

const records: ContainerRecord[] = [
  createRecord({
    id: "tomorrow-far",
    address: "Zwycięska 9",
    startDate: "2026-06-16",
    lat: 51.2,
    lng: 17.2,
  }),
  createRecord({
    id: "tomorrow-near",
    address: "Dębowa 2a",
    startDate: "2026-06-16",
    lat: 51.1,
    lng: 17.001,
  }),
  createRecord({
    id: "two-days",
    address: "Legnicka 10",
    startDate: "2026-06-17",
    lat: 51.12,
    lng: 17.01,
  }),
  createRecord({
    id: "friday",
    address: "Rynek 1",
    startDate: "2026-06-19",
    lat: 51.11,
    lng: 17.03,
  }),
  createRecord({
    id: "last-day",
    address: "Ostatnia 14",
    startDate: "2026-06-29",
    lat: 51.13,
    lng: 17.04,
  }),
  createRecord({
    id: "too-late",
    address: "Za późno 15",
    startDate: "2026-06-30",
    lat: 51.14,
    lng: 17.05,
  }),
];

describe("groupUpcomingContainers", () => {
  it("grupuje okres od jutra do 14. dnia włącznie", () => {
    const groups = groupUpcomingContainers(
      records,
      "2026-06-15",
      null,
      null,
    );

    assert.deepEqual(
      groups.map(({ date }) => date),
      ["2026-06-16", "2026-06-17", "2026-06-19", "2026-06-29"],
    );
    assert.equal(groups[0].label, "Jutro");
    assert.equal(groups[1].label, "Za 2 dni");
    assert.equal(groups[2].label, "Piątek 19.06.2026");
  });

  it("bez lokalizacji sortuje adresy alfabetycznie", () => {
    const [tomorrow] = groupUpcomingContainers(
      records,
      "2026-06-15",
      null,
      null,
    );

    assert.deepEqual(
      tomorrow.containers.map(({ id }) => id),
      ["tomorrow-near", "tomorrow-far"],
    );
    assert.equal(tomorrow.containers[0].distanceMeters, null);
  });

  it("z lokalizacją sortuje po odległości i filtruje promień", () => {
    const groups = groupUpcomingContainers(
      records,
      "2026-06-15",
      { lat: 51.1, lng: 17 },
      1,
    );

    assert.deepEqual(groups.map(({ date }) => date), ["2026-06-16"]);
    assert.deepEqual(
      groups[0].containers.map(({ id }) => id),
      ["tomorrow-near"],
    );
    assert.ok((groups[0].containers[0].distanceMeters ?? Infinity) < 100);
  });
});

describe("formatUpcomingDateLabel", () => {
  it("formatuje etykiety względne i pełną datę z dniem tygodnia", () => {
    assert.equal(formatUpcomingDateLabel("2026-06-16", 1), "Jutro");
    assert.equal(formatUpcomingDateLabel("2026-06-17", 2), "Za 2 dni");
    assert.equal(
      formatUpcomingDateLabel("2026-06-19", 4),
      "Piątek 19.06.2026",
    );
  });
});

function createRecord(
  values: Pick<
    ContainerRecord,
    "id" | "address" | "startDate" | "lat" | "lng"
  >,
): ContainerRecord {
  return {
    ...values,
    district: "Testowe osiedle",
    endDate: values.startDate,
    sourceMapUrl: "https://gabaryty.ekosystem.wroc.pl/",
    sourcePageUrl:
      "https://gabaryty.ekosystem.wroc.pl/tabela-wywozu-odpadow/",
    syncVersion: "test",
    syncedAt: "2026-06-15T10:00:00.000Z",
  };
}
