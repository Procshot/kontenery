import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { Coordinates } from "./locationService";

const REMEMBERED_LOCATION_KEY = "containers:remembered-location";

export interface UserLocation extends Coordinates {
  accuracy: number | null;
  label: string;
  source: "device" | "address";
  saved: boolean;
  updatedAt: string;
}

export interface UserLocationInput extends Coordinates {
  accuracy?: number | null;
  label: string;
  source: UserLocation["source"];
}

interface LocationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const UserLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable(),
  label: z.string().min(1),
  source: z.enum(["device", "address"]),
  saved: z.boolean(),
  updatedAt: z.iso.datetime(),
});

const LegacyLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable(),
  label: z.string().min(1),
  source: z.enum(["device", "address"]),
  savedAt: z.iso.datetime(),
});

export interface LocationStore {
  getSnapshot(): UserLocation | null;
  subscribe(listener: () => void): () => void;
  setLocation(input: UserLocationInput, saved: boolean): UserLocation;
  setSaved(saved: boolean): void;
}

export function createLocationStore(
  storage: LocationStorage | null = getLocalStorage(),
): LocationStore {
  const listeners = new Set<() => void>();
  let location = readStoredLocation(storage);

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function persist(nextLocation: UserLocation | null) {
    if (!storage) return;

    try {
      if (nextLocation?.saved) {
        storage.setItem(
          REMEMBERED_LOCATION_KEY,
          JSON.stringify(nextLocation),
        );
      } else {
        storage.removeItem(REMEMBERED_LOCATION_KEY);
      }
    } catch {
      // Brak dostępu do localStorage nie blokuje lokalizacji w bieżącej sesji.
    }
  }

  return {
    getSnapshot: () => location,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocation(input, saved) {
      location = UserLocationSchema.parse({
        ...input,
        accuracy: input.accuracy ?? null,
        saved,
        updatedAt: new Date().toISOString(),
      });
      persist(location);
      notify();
      return location;
    },
    setSaved(saved) {
      if (location) {
        location = { ...location, saved, updatedAt: new Date().toISOString() };
      }
      persist(location);
      notify();
    },
  };
}

const locationStore = createLocationStore();

export function useUserLocation(): UserLocation | null {
  return useSyncExternalStore(
    locationStore.subscribe,
    locationStore.getSnapshot,
    () => null,
  );
}

export function setUserLocation(
  input: UserLocationInput,
  saved: boolean,
): UserLocation {
  return locationStore.setLocation(input, saved);
}

export function setLocationSaved(saved: boolean): void {
  locationStore.setSaved(saved);
}

function readStoredLocation(storage: LocationStorage | null): UserLocation | null {
  if (!storage) return null;

  try {
    const value = storage.getItem(REMEMBERED_LOCATION_KEY);
    if (!value) return null;
    const json: unknown = JSON.parse(value);

    const current = UserLocationSchema.safeParse(json);
    if (current.success) {
      return { ...current.data, saved: true };
    }

    const legacy = LegacyLocationSchema.safeParse(json);
    if (legacy.success) {
      const { savedAt, ...rest } = legacy.data;
      const migrated = UserLocationSchema.parse({
        ...rest,
        label:
          legacy.data.source === "device"
            ? "lokalizacja urządzenia"
            : legacy.data.label,
        saved: true,
        updatedAt: savedAt,
      });
      storage.setItem(REMEMBERED_LOCATION_KEY, JSON.stringify(migrated));
      return migrated;
    }

    storage.removeItem(REMEMBERED_LOCATION_KEY);
    return null;
  } catch {
    return null;
  }
}

function getLocalStorage(): LocationStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
