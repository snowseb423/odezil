// Tests de bout en bout (npm run test:e2e), à 375 px, contre un faux
// Supabase simulé par les tests (Auth, REST, RPC, Storage) :
// - projet « app » : service worker désactivé, parcours principaux ;
// - projet « pwa » : service worker actif (hors ligne, cache, installation).
import { defineConfig } from '@playwright/test'

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    timezoneId: 'Indian/Mauritius',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'app', testMatch: /app\.spec\.ts/, use: { serviceWorkers: 'block' } },
    { name: 'pwa', testMatch: /pwa\.spec\.ts/, use: { serviceWorkers: 'allow' } },
  ],
  webServer: {
    command: 'vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'http://supabase.e2e',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-key',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_ADMIN_EMAIL: 'admin@example.com',
    },
  },
})
