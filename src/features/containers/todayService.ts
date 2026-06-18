import type { ContainerRecord } from "../../db/db";
import {
  calculateDistanceMeters,
  type Coordinates,
} from "../location/locationService";

export type RadiusFilter = 1 | 2 | 5 | 10 | "all";

export interface TodayContainer extends ContainerRecord {
  distanceMeters: number | null;
  daysRemaining: number;
}

export interface TodayFilters {
  query: string;
  radius: RadiusFilter;
}

export function filterAndSortTodayContainers(
  records: readonly ContainerRecord[],
  today: string,
  origin: Coordinates | null,
  filters: TodayFilters,
): TodayContainer[] {
  const normalizedQuery = normalizeSearchText(filters.query);
  const radiusMeters =
    filters.radius === "all" ? Number.POSITIVE_INFINITY : filters.radius * 1_000;

  return records
    .filter(
      (record) => record.startDate <= today && record.endDate >= today,
    )
    .filter((record) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText(
        `${record.address} ${record.district}`,
      ).includes(normalizedQuery);
    })
    .map((record): TodayContainer => {
      const distanceMeters = origin
        ? calculateDistanceMeters(
            origin.lat,
            origin.lng,
            record.lat,
            record.lng,
          )
        : null;

      return {
        ...record,
        distanceMeters,
        daysRemaining: differenceInCalendarDays(today, record.endDate),
      };
    })
    .filter(
      (record) =>
        filters.radius === "all" ||
        (record.distanceMeters !== null &&
          record.distanceMeters <= radiusMeters),
    )
    .sort((left, right) => {
      if (origin) {
        const distanceDifference =
          (left.distanceMeters ?? Number.POSITIVE_INFINITY) -
          (right.distanceMeters ?? Number.POSITIVE_INFINITY);
        if (distanceDifference !== 0) return distanceDifference;
      }

      return (
        left.startDate.localeCompare(right.startDate) ||
        left.address.localeCompare(right.address, "pl")
      );
    });
}

export function formatDistance(distanceMeters: number | null): string {
  if (distanceMeters === null) return "Odległość niedostępna";
  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters).toLocaleString("pl-PL")} m`;
  }

  return `${(distanceMeters / 1_000).toLocaleString("pl-PL", {
    maximumFractionDigits: 1,
  })} km`;
}

export function formatDaysRemaining(daysRemaining: number): string {
  if (daysRemaining === 0) return "0 dni (ostatni dzień)";
  if (daysRemaining === 1) return "1 dzień";
  return `${daysRemaining} dni`;
}

export function buildNavigationUrl(lat: number, lng: number): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${lat},${lng}`);
  return url.href;
}

function differenceInCalendarDays(startDate: string, endDate: string): number {
  const start = isoDateToUtc(startDate);
  const end = isoDateToUtc(endDate);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function isoDateToUtc(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pl")
    .replace(/\s+/g, " ")
    .trim();
}
