# Gabaryty Wrocław

Statyczna aplikacja PWA do lokalnego wyszukiwania kontenerów na odpady
wielkogabarytowe we Wrocławiu. Harmonogram jest generowany przez skrypt
synchronizacji i zapisywany w `public/data/containers.json`.

## Wymagania

- Node.js 22
- npm

Projekt nie wymaga płatnych usług ani kluczy API.

Opcjonalne ustawienia lokalne:

```bash
cp .env.example .env
```

## Uruchomienie lokalne

```bash
npm ci
npm run dev
```

Aplikacja będzie dostępna pod adresem podanym przez Vite, domyślnie
`http://localhost:5173`.

## Synchronizacja danych

```bash
npm run sync:data
npm run validate:data
```

Skrypt pobiera dane Ekosystemu, waliduje rekordy i atomowo zapisuje wynik do
`public/data/containers.json`. Lokalny cache pomocniczy znajduje się w
`.cache/ekosystem` i nie jest częścią repozytorium.

Pełne odświeżenie z pominięciem świeżego cache:

```bash
npm run sync:data -- --refresh
```

Synchronizacja kończy się błędem przed zapisem, jeżeli nie uzyska żadnego
poprawnego rekordu. Dodatkowo `npm run validate:data` blokuje build dla pustego
pliku lub zduplikowanych identyfikatorów.

## Build PWA

```bash
npm test
npm run build
npm run preview
```

Gotowa aplikacja statyczna trafia do katalogu `dist`.

Przy publikacji w podkatalogu można ustawić bazową ścieżkę:

```bash
VITE_BASE_PATH=/nazwa-repozytorium/ npm run build
```

## Deployment na GitHub Pages

Workflow `.github/workflows/deploy-pages.yml`:

- uruchamia się po pushu do `main`,
- uruchamia się codziennie o `05:15 UTC`, czyli rano w Polsce,
- można go uruchomić ręcznie przez `Actions → Synchronize and deploy PWA → Run workflow`,
- synchronizuje i waliduje dane,
- wykonuje testy oraz build,
- publikuje katalog `dist` w GitHub Pages.

Pierwsza konfiguracja repozytorium:

1. Otwórz `Settings → Pages`.
2. W sekcji `Build and deployment` ustaw `Source` na `GitHub Actions`.
3. Upewnij się, że domyślną gałęzią jest `main`.
4. Uruchom workflow ręcznie lub wykonaj push do `main`.

Workflow używa ścieżki bazowej zwróconej przez GitHub Pages, dlatego działa
zarówno dla `https://uzytkownik.github.io/repo/`, jak i dla strony użytkownika
lub własnej domeny. Nie wymaga sekretów ani płatnych usług.

## Instalacja na iPhonie

1. Otwórz aplikację w Safari.
2. Wybierz `Udostępnij`.
3. Wybierz `Dodaj do ekranu początkowego`.

Na Androidzie otwórz aplikację w Chrome i wybierz `Zainstaluj aplikację`.

## Tryb offline

Service worker zapisuje wersjonowany app shell: HTML, JavaScript, CSS, manifest
i ikony. Plik `containers.json` nie jest agresywnie cache'owany przez service
workera. Podczas synchronizacji aplikacja najpierw próbuje pobrać aktualny plik
z sieci, a przy braku połączenia korzysta z ostatniego poprawnego snapshotu w
IndexedDB.

Po co najmniej jednej udanej synchronizacji zakładki `Dzisiaj`, `Następne` i
lista punktów mapy działają offline. Same kafelki OpenStreetMap nadal wymagają
internetu.

## Zmienne środowiskowe

Przykładowe wartości znajdują się w `.env.example`:

- `VITE_BASE_PATH` - bazowa ścieżka hostingu; lokalnie `/`,
- `EKOSYSTEM_CACHE_TTL_MS` - opcjonalny czas ważności cache synchronizatora.
