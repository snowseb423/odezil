/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rolldownOptions: {
      output: {
        // Bibliothèques dans des fichiers à part : une mise à jour de l'app ne
        // retélécharge que le code qui a changé.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/](@supabase|tslib|phoenix|ws)[\\/]/ },
            { name: 'dexie', test: /node_modules[\\/](dexie|dexie-react-hooks)[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Service worker écrit à la main (src/sw.ts), manifeste de precache injecté.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png', 'offline.html'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
      },
      manifest: {
        id: '/',
        name: 'EauPartagée — bonbonnes d’eau partagées',
        short_name: 'EauPartagée',
        description: 'Remplacements de bonbonnes Odezil, répartition des livraisons entre deux foyers et solde à régler.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0369A1',
        background_color: '#F4F8FB',
        categories: ['finance', 'utilities', 'lifestyle'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Livraisons', short_name: 'Livraisons', url: '/livraisons', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Journal', short_name: 'Journal', url: '/journal', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
