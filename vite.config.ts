import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = normalizeBasePath(
    process.env.VITE_BASE_PATH ?? env.VITE_BASE_PATH,
  );

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: false,
        manifestFilename: "manifest.webmanifest",
        manifest: {
          name: "Gabaryty Wrocław",
          short_name: "Gabaryty",
          description:
            "Lokalna wyszukiwarka kontenerów na odpady wielkogabarytowe we Wrocławiu.",
          lang: "pl",
          start_url: base,
          scope: base,
          display: "standalone",
          orientation: "portrait-primary",
          background_color: "#f4f6f1",
          theme_color: "#173f2c",
          categories: ["utilities", "navigation"],
          icons: [
            {
              src: `${base}icons/pwa-192x192.png`,
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: `${base}icons/pwa-512x512.png`,
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: `${base}icons/maskable-512x512.png`,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        includeAssets: [
          "icons/pwa-192x192.png",
          "icons/pwa-512x512.png",
          "icons/maskable-512x512.png",
        ],
        workbox: {
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/\/data\//],
          globPatterns: ["**/*.{js,css,html,ico,svg,woff,woff2}"],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /\/data\/containers\.json(?:\?.*)?$/,
              handler: "NetworkOnly",
            },
            {
              urlPattern: /\.(?:js|css|png|svg|ico|woff|woff2)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "app-shell-assets-v1",
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                  purgeOnQuotaError: true,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
  };
});

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}
