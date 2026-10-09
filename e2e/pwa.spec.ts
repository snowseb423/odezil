// PWA avec service worker actif : ouverture et saisie hors ligne, file
// renvoyée au retour du réseau, aucun cache des réponses Supabase, manifest
// et icônes installables.
import { expect, test } from '@playwright/test'
import { FakeSupabase, freezeClock } from './fake-supabase.ts'

let server: FakeSupabase

test.beforeEach(async ({ context, page }) => {
  server = new FakeSupabase()
  await server.install(context)
  await freezeClock(page)
})

test('hors ligne : l’app s’ouvre, enregistre un remplacement, puis l’envoie au retour du réseau', async ({ context, page }) => {
  await server.signIn(context)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Bonbonne remplacée/ })).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)
  await expect(page.getByRole('button', { name: /Synchronisation : En ligne, tout est synchronisé/ })).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: /Bonbonne remplacée/ })).toBeVisible()
  await expect(page.getByTestId('offline-banner')).toHaveText('Hors ligne : les saisies partiront au retour du réseau')

  await page.getByRole('button', { name: /Bonbonne remplacée/ }).click()
  await expect(page.getByTestId('pending-count')).toHaveText('1')
  await expect(page.getByRole('button', { name: /Synchronisation : Hors ligne, 1 en attente de synchronisation/ })).toBeVisible()
  expect(server.replacements.size).toBe(0)
  await page.screenshot({ path: 'test-results/screens/hors-ligne.png' })

  await context.setOffline(false)
  await expect.poll(() => server.replacements.size, { timeout: 15_000 }).toBe(1)
  await expect(page.getByRole('button', { name: /Synchronisation : En ligne, tout est synchronisé/ })).toBeVisible()
})

test('le service worker ne met en cache aucune réponse Supabase (RPC, REST, Storage)', async ({ context, page }) => {
  await server.signIn(context)
  const token = 'k3J9xQ2mV7pL0sN4tR8wY1zA6bC5dE3fG2hJ9kL0mN8'
  server.seedShareLink(token)
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)
  for (const path of ['/', '/journal', '/livraisons', '/mois', '/solde', '/reglages', `/p/${token}`]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  await expect(page.getByTestId('shared-balance')).toBeVisible()
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(0)
  // Uniquement l'app elle-même (precache) : aucune réponse de Supabase, aucune page partagée.
  const origin = new URL(page.url()).origin
  expect(cached.filter((url) => new URL(url).origin !== origin || new URL(url).pathname.startsWith('/p/'))).toEqual([])
})

test('installable : manifest, icônes et page de repli précachées', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const manifest = (await (await request.get(href!)).json()) as Record<string, unknown> & { icons: { src: string; sizes: string; purpose?: string }[] }
  expect(manifest).toMatchObject({
    name: 'EauPartagée — bonbonnes d’eau partagées',
    short_name: 'EauPartagée',
    start_url: '/',
    display: 'standalone',
    theme_color: '#0369A1',
    background_color: '#F4F8FB',
    lang: 'fr',
  })
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons) {
    const response = await request.get(`/${icon.src}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)
  const precached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
    return urls
  })
  expect(precached).toEqual(expect.arrayContaining(['/index.html', '/offline.html', '/manifest.webmanifest']))
})
