import type { UpcomingContainer } from "./nextService";
import { DetailedContainerCard } from "./ContainerCard";

export function UpcomingContainerCard({
  container,
  daysFromToday,
}: {
  container: UpcomingContainer;
  daysFromToday: number;
}) {
  return (
    <DetailedContainerCard
      container={container}
      distanceMeters={container.distanceMeters}
      statusLabel={formatUpcomingStatus(daysFromToday)}
    />
  );
}

function formatUpcomingStatus(daysFromToday: number): string {
  if (daysFromToday === 1) return "Jutro";
  return `Za ${daysFromToday} dni`;
}
