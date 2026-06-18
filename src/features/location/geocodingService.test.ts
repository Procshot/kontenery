import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GeocodingError,
  geocodeAddressInWroclaw,
  isPointInsideWroclawBounds,
  normalizeWroclawAddressQuery,
  resolveAddressInWroclaw,
  type GeocodingStorage,
} from "./geocodingService";
import { createLocationStore } from "./locationStore";

const NOMINATIM_RESULT = {
  lat: "51.0812",
  lon: "17.0152",
  display_name: "Dębowa 2A, Borek, Wrocław, Polska",
  importance: 0.7,
  address: {
    road: "Dębowa",
    house_number: "2A",
    suburb: "Borek",
    city: "Wrocław",
  },
};

describe("geocodingService", () => {
  it("uzupełnia zapytanie o Wrocław i Polskę", () => {
    const normalized = normalizeWroclawAddressQuery("Dębowa 2a");

    assert.match(normalized, /Dębowa 2a/);
    assert.match(normalized, /Wrocław/);
    assert.match(normalized, /Polska/);
  });

  it("nie dodaje Wrocławia drugi raz, gdy jest już w zapytaniu", () => {
    const normalized = normalizeWroclawAddressQuery("Rynek 1, Wrocław");

    assert.equal(normalized.match(/Wrocław/g)?.length, 1);
  });

  it("rozpoznaje punkt we Wrocławiu", () => {
    assert.equal(isPointInsideWroclawBounds(51.1079, 17.0385), true);
  });

  it("odrzuca punkt poza Wrocławiem", () => {
    assert.equal(isPointInsideWroclawBounds(52.2297, 21.0122), false);
  });

  it("najpierw korzysta z lokalnego źródła", async () => {
    let fetchCalls = 0;
    const results = await resolveAddressInWroclaw(
      [{ address: "Dębowa 2a", district: "Borek", lat: 51.0812, lng: 17.0152 }],
      "Dębowa 2a",
      {
        fetchFn: async () => {
          fetchCalls += 1;
          throw new Error("fetch nie powinien zostać wywołany");
        },
      },
    );

    assert.equal(results[0]?.provider, "local");
    assert.equal(fetchCalls, 0);
  });

  it("przy braku lokalnego wyniku korzysta z providera online", async () => {
    let requestedUrl = "";
    const results = await resolveAddressInWroclaw([], "Dębowa 2a", {
      fetchFn: async (input) => {
        requestedUrl = String(input);
        return jsonResponse([NOMINATIM_RESULT]);
      },
      rateLimitMs: 0,
      storage: createMemoryStorage(),
    });

    assert.equal(results[0]?.provider, "nominatim");
    assert.equal(results[0]?.label, "Dębowa 2A, Wrocław");
    const parsedUrl = new URL(requestedUrl);
    assert.match(parsedUrl.searchParams.get("q") ?? "", /Wrocław/);
    assert.equal(parsedUrl.searchParams.get("bounded"), "1");
    assert.equal(parsedUrl.searchParams.get("countrycodes"), "pl");
  });

  it("odrzuca wyniki spoza przybliżonych granic Wrocławia", async () => {
    await assert.rejects(
      geocodeAddressInWroclaw("Rynek 1", {
        fetchFn: async () =>
          jsonResponse([
            {
              ...NOMINATIM_RESULT,
              lat: "52.2297",
              lon: "21.0122",
              display_name: "Rynek 1, Warszawa, Polska",
            },
          ]),
        rateLimitMs: 0,
        storage: createMemoryStorage(),
      }),
      (error) =>
        error instanceof GeocodingError && error.code === "outside-wroclaw",
    );
  });

  it("odrzuca miejscowości pod Wrocławiem znajdujące się w bounding boxie", async () => {
    await assert.rejects(
      geocodeAddressInWroclaw("Dębowa 2a", {
        fetchFn: async () =>
          jsonResponse([
            {
              ...NOMINATIM_RESULT,
              lat: "51.0895954",
              lon: "17.1952940",
              display_name: "Dębowa 2A, Dobrzykowice, Polska",
              address: {
                road: "Dębowa",
                house_number: "2A",
                village: "Dobrzykowice",
                municipality: "gmina Czernica",
                county: "powiat wrocławski",
              },
            },
          ]),
        rateLimitMs: 0,
        storage: createMemoryStorage(),
      }),
      (error) =>
        error instanceof GeocodingError && error.code === "outside-wroclaw",
    );
  });

  it("używa cache przed sprawdzeniem połączenia", async () => {
    const storage = createMemoryStorage();
    await geocodeAddressInWroclaw("Legnicka 58", {
      fetchFn: async () =>
        jsonResponse([
          {
            ...NOMINATIM_RESULT,
            display_name: "Legnicka 58, Wrocław, Polska",
            address: {
              road: "Legnicka",
              house_number: "58",
              suburb: "Szczepin",
              city: "Wrocław",
            },
          },
        ]),
      rateLimitMs: 0,
      storage,
    });

    const cached = await geocodeAddressInWroclaw("Legnicka 58", {
      fetchFn: async () => {
        throw new Error("cache powinien zapobiec zapytaniu");
      },
      isOnline: false,
      storage,
    });

    assert.equal(cached[0]?.label, "Legnicka 58, Wrocław");
  });

  it("scala techniczne warianty tego samego adresu", async () => {
    const results = await geocodeAddressInWroclaw("Dębowa 2a", {
      fetchFn: async () =>
        jsonResponse([
          NOMINATIM_RESULT,
          {
            ...NOMINATIM_RESULT,
            lat: "51.08121",
            lon: "17.01521",
            address: {
              ...NOMINATIM_RESULT.address,
              road: "aleja Dębowa",
              house_number: "2a",
            },
          },
        ]),
      rateLimitMs: 0,
      storage: createMemoryStorage(),
    });

    assert.equal(results.length, 1);
  });

  it("błąd sieci nie usuwa poprzedniej lokalizacji", async () => {
    const store = createLocationStore(createMemoryStorage());
    store.setLocation(
      {
        lat: 51.1079,
        lng: 17.0385,
        label: "Rynek 1, Wrocław",
        source: "address",
      },
      false,
    );

    await assert.rejects(
      geocodeAddressInWroclaw("Nieistniejąca 999", {
        fetchFn: async () => {
          throw new TypeError("network error");
        },
        rateLimitMs: 0,
        storage: createMemoryStorage(),
      }),
      GeocodingError,
    );

    assert.equal(store.getSnapshot()?.label, "Rynek 1, Wrocław");
  });

  it("wybrany wynik może zaktualizować globalny stan lokalizacji", async () => {
    const result = (
      await geocodeAddressInWroclaw("Dębowa 2a", {
        fetchFn: async () => jsonResponse([NOMINATIM_RESULT]),
        rateLimitMs: 0,
        storage: createMemoryStorage(),
      })
    )[0];
    assert.ok(result);

    const store = createLocationStore(createMemoryStorage());
    store.setLocation(
      {
        lat: result.lat,
        lng: result.lng,
        label: result.label,
        source: "address",
      },
      true,
    );

    assert.equal(store.getSnapshot()?.label, "Dębowa 2A, Wrocław");
    assert.equal(store.getSnapshot()?.source, "address");
    assert.equal(store.getSnapshot()?.saved, true);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createMemoryStorage(): GeocodingStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
