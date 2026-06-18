import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { TodayPage } from "../features/containers/TodayPage";
import { NextPage } from "../features/containers/NextPage";
import { MapPage } from "../features/map/MapPage";
import { SyncPage } from "../features/sync/SyncPage";
import { SyncProvider } from "../features/sync/SyncProvider";

export function App() {
  return (
    <SyncProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<TodayPage />} />
            <Route path="next" element={<NextPage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="settings" element={<SyncPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </SyncProvider>
  );
}
