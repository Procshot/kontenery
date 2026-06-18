import {
  CalendarClock,
  CalendarDays,
  MapPinned,
  RefreshCw,
} from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/", label: "Dzisiaj", icon: CalendarDays, end: true },
  { to: "/next", label: "Następne", icon: CalendarClock },
  { to: "/map", label: "Mapa", icon: MapPinned },
  { to: "/settings", label: "Synchronizacja", icon: RefreshCw },
];

export function BottomNavigation() {
  return (
    <nav className="bottom-navigation" aria-label="Główna nawigacja">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          className={({ isActive }) =>
            `nav-item${isActive ? " nav-item--active" : ""}`
          }
          to={to}
          end={end}
        >
          <Icon size={21} strokeWidth={2.2} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
