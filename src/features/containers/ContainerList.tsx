import type { ContainerRecord } from "../../db/db";
import { ContainerCard } from "./ContainerCard";
import type { TodayContainer } from "./todayService";

export function ContainerList({
  containers,
  detailed = false,
}: {
  containers: Array<ContainerRecord | TodayContainer>;
  detailed?: boolean;
}) {
  return (
    <div
      className={`container-list${detailed ? " container-list--detailed" : ""}`}
    >
      {containers.map((container) => (
        <ContainerCard
          key={container.id}
          container={container}
          detailed={detailed}
        />
      ))}
    </div>
  );
}
