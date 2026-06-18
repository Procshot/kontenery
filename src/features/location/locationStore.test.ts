import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLocationStore } from "./locationStore";

describe("locationStore", () => {
  it("ustawienie lokalizacji urządzenia aktualizuje globalny stan", () => {
    const storage = createMemoryStorage();
    const store = createLocationStore(storage);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.setLocation(
      {
        lat: 51.1079,
        lng: 17.0385,
        accuracy: 25,
        label: "lokalizacja urządzenia",
        source: "device",
      },
      true,
    );

    assert.equal(store.getSnapshot()?.source, "device");
    assert.equal(store.getSnapshot()?.saved, true);
    assert.equal(notifications, 1);
    assert.ok(storage.getItem("containers:remembered-location"));
    unsubscribe();
  });

  it("odczytuje zapamiętaną lokalizację przy tworzeniu store", () => {
    const storage = createMemoryStorage();
    const firstStore = createLocationStore(storage);
    firstStore.setLocation(
      {
        lat: 51.0812,
        lng: 17.0152,
        label: "Dębowa 2a",
        source: "address",
      },
      true,
    );

    const restoredStore = createLocationStore(storage);

    assert.equal(restoredStore.getSnapshot()?.label, "Dębowa 2a");
    assert.equal(restoredStore.getSnapshot()?.saved, true);
  });

  it("wyłączenie zapamiętywania zachowuje stan sesji i czyści storage", () => {
    const storage = createMemoryStorage();
    const store = createLocationStore(storage);
    store.setLocation(
      {
        lat: 51.0812,
        lng: 17.0152,
        label: "Dębowa 2a",
        source: "address",
      },
      true,
    );

    store.setSaved(false);

    assert.equal(store.getSnapshot()?.label, "Dębowa 2a");
    assert.equal(store.getSnapshot()?.saved, false);
    assert.equal(storage.getItem("containers:remembered-location"), null);
  });
});

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
