import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDistanceMeters,
  findAddressMatch,
  sortByDistance,
} from "./locationService";

describe("calculateDistanceMeters", () => {
  it("zwraca zero dla tego samego punktu", () => {
    assert.equal(
      calculateDistanceMeters(51.1079, 17.0385, 51.1079, 17.0385),
      0,
    );
  });

  it("liczy odległość zgodnie ze wzorem Haversine", () => {
    const distance = calculateDistanceMeters(0, 0, 0, 1);

    assert.ok(Math.abs(distance - 111_195) < 100);
  });
});

describe("sortByDistance", () => {
  it("sortuje kopię rekordów od najbliższego i nie zmienia wejścia", () => {
    const records = [
      { id: "far", lat: 51.2, lng: 17.2 },
      { id: "near", lat: 51.101, lng: 17.001 },
      { id: "middle", lat: 51.15, lng: 17.1 },
    ];
    const originalOrder = records.map(({ id }) => id);

    const sorted = sortByDistance(records, { lat: 51.1, lng: 17 });

    assert.deepEqual(
      sorted.map(({ id }) => id),
      ["near", "middle", "far"],
    );
    assert.deepEqual(
      records.map(({ id }) => id),
      originalOrder,
    );
  });

  it("zachowuje kolejność rekordów w tej samej odległości", () => {
    const records = [
      { id: "first", lat: 0, lng: 1 },
      { id: "second", lat: 0, lng: -1 },
    ];

    assert.deepEqual(
      sortByDistance(records, { lat: 0, lng: 0 }).map(({ id }) => id),
      ["first", "second"],
    );
  });
});

describe("findAddressMatch", () => {
  it("dopasowuje lokalny adres bez względu na polskie znaki i wielkość liter", () => {
    const records = [
      { address: "al. Dębowa 2a", lat: 51.08, lng: 17.01 },
      { address: "Legnicka 10", lat: 51.12, lng: 17.0 },
    ];

    assert.equal(
      findAddressMatch(records, "DEBOWA 2A")?.address,
      "al. Dębowa 2a",
    );
  });

  it("zwraca null, gdy adresu nie ma w lokalnych danych", () => {
    const records = [
      { address: "al. Dębowa 2a", lat: 51.08, lng: 17.01 },
      { address: "Legnicka 10", lat: 51.12, lng: 17.0 },
    ];

    assert.equal(findAddressMatch(records, "Nieistniejąca 999"), null);
  });
});
