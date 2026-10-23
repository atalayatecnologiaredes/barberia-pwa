import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.svg", "icon-512.svg", "maskable-icon.svg"],
      manifest: {
        name: "Barber Lounge",
        short_name: "Barber Lounge",
        description: "Reservas, turnos y fidelidad de Barber Lounge",
        theme_color: "#0D0D0E",
        background_color: "#0D0D0E",
        display: "standalone",
        start_url: "/client-pwa",
        icons: [
          { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
          { src: "/maskable-icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,json,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          { urlPattern: ({ request }) => ["style", "script", "image"].includes(request.destination), handler: "StaleWhileRevalidate", options: { cacheName: "barber-static-v1", expiration: { maxEntries: 80, maxAgeSeconds: 2_592_000 } } },
          { urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkFirst", options: { cacheName: "barber-api-v1", networkTimeoutSeconds: 3, expiration: { maxEntries: 100, maxAgeSeconds: 86_400 } } },
        ],
      },
    }),
  ],
  build: { target: "esnext" },
});
