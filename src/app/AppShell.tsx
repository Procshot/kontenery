import { Outlet } from "react-router-dom";
import { BottomNavigation } from "../components/BottomNavigation";
import { OfflineBanner } from "../components/OfflineBanner";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <img
          className="app-logo"
          src={`${import.meta.env.BASE_URL}icons/pwa-192x192.png`}
          alt=""
          width="44"
          height="44"
        />
        <div>
          <p className="eyebrow">Wrocław</p>
          <p className="app-name">Gabaryty blisko Ciebie</p>
        </div>
      </header>

      <OfflineBanner />

      <main className="page-content">
        <Outlet />
      </main>

      <BottomNavigation />
    </div>
  );
}
