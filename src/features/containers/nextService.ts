import type { ContainerRecord } from "../../db/db";
import {
  calculateDistanceMeters,
  type Coordinates,
} from "../location/locationService";

export type UpcomingRadiusKm = 1 | 2 | 5 | 10;

export interface UpcomingContainer extends ContainerRecord {
  distanceMeters: number | null;
}

export interface UpcomingGroup {
  date: string;
  label: string;
  daysFromToday: number;
  containers: UpcomingContainer[];
}

export function groupUpcomingContainers(
  records: readonly ContainerRecord[],
  today: string,
  origin: Coordinates | null,
  radiusKm: UpcomingRadiusKm | null,
): UpcomingGroup[] {
  const lastDate = addDays(today, 14);
  const radiusMeters = radiusKm === null ? null : radiusKm * 1_000;
  const grouped = new Map<string, UpcomingContainer[]>();

  for (const record of records) {
    if (record.startDate <= today || record.startDate > lastDate) continue;

    const distanceMeters = origin
      ? calculateDistanceMeters(
          origin.lat,
          origin.lng,
          record.lat,
          record.lng,
        )
      : null;

    if (
      radiusMeters !== null &&
      (distanceMeters === null || distanceMeters > radiusMeters)
    ) {
      continue;
    }

    const group = grouped.get(record.startDate) ?? [];
    group.push({ ...record, distanceMeters });
    grouped.set(record.startDate, group);
  }

  return [...grouped.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, containers]) => {
      const daysFromToday = differenceInCalendarDays(today, date);
      return {
        date,
        daysFromToday,
        label: formatUpcomingDateLabel(date, daysFromToday),
        containers: containers.sort((left, right) => {
          if (origin) {
            const distanceDifference =
              (left.distanceMeters ?? Number.POSITIVE_INFINITY) -
              (right.distanceMeters ?? Number.POSITIVE_INFINITY);
            if (distanceDifference !== 0) return distanceDifference;
          }

          return left.address.localeCompare(right.address, "pl");
        }),
      };
    });
}

export function formatUpcomingDateLabel(
  date: string,
  daysFromToday: number,
): string {
  if (daysFromToday === 1) return "Jutro";
  if (daysFromToday === 2) return "Za 2 dni";

  const weekday = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    timeZone: "Europe/Warsaw",
  }).format(toLocalNoon(date));

  return `${capitalize(weekday)} ${formatNumericDate(date)}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function differenceInCalendarDays(startDate: string, endDate: string): number {
  return Math.round(
    (isoDateToUtc(endDate) - isoDateToUtc(startDate)) / 86_400_000,
  );
}

function isoDateToUtc(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatNumericDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function toLocalNoon(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("pl") + value.slice(1);
}
