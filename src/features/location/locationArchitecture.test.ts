import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("architektura lokalizacji", () => {
  it("renderuje formularz tylko w zakładce Dzisiaj", async () => {
    const [todaySource, nextSource, mapSource] = await Promise.all([
      readSource("src/features/containers/TodayPage.tsx"),
      readSource("src/features/containers/NextPage.tsx"),
      readSource("src/features/map/MapPage.tsx"),
    ]);

    assert.match(todaySource, /<LocationSetupCard \/>/);
    assert.doesNotMatch(todaySource, /SyncStatusCard|today-search/);
    assert.doesNotMatch(nextSource, /LocationSetupCard|LocationPanel/);
    assert.doesNotMatch(mapSource, /LocationSetupCard|LocationPanel/);
  });

  it("Następne i Mapa czytają ten sam globalny store", async () => {
    const [nextSource, mapSource] = await Promise.all([
      readSource("src/features/containers/NextPage.tsx"),
      readSource("src/features/map/MapPage.tsx"),
    ]);

    assert.match(nextSource, /useUserLocation\(\)/);
    assert.match(mapSource, /useUserLocation\(\)/);
  });
});

function readSource(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}
