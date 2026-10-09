// Parcours principaux à 375 px, contre le faux Supabase (service worker désactivé).
import { expect, test } from '@playwright/test'
import { FakeSupabase, freezeClock } from './fake-supabase.ts'

let server: FakeSupabase

test.beforeEach(async ({ context, page }) => {
  server = new FakeSupabase()
  await server.install(context)
  await freezeClock(page)
})

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true })
}

test.describe('accueil et journal', () => {
  test.beforeEach(async ({ context }) => {
    await server.signIn(context)
  })

  test('« Bonbonne remplacée » : un appui, protégé contre le double appui, annulable', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('button', { name: /Bonbonne remplacée/ })
    await expect(button).toBeVisible()
    await expect(page.getByTestId('pending-count')).toHaveText('0')

    await button.click()
    await expect(page.getByRole('button', { name: /Enregistré/ })).toBeDisabled()
    // Double appui ignoré pendant le verrouillage.
    await page.getByRole('button', { name: /Enregistré/ }).click({ force: true })
    await expect(page.getByTestId('pending-count')).toHaveText('1')
    await expect(page.getByText('Bonbonne remplacée à 09h00')).toBeVisible()
    await expect.poll(() => server.replacements.size).toBe(1)
    await shot(page, 'accueil')

    await page.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByTestId('pending-count')).toHaveText('0')
    await expect.poll(() => server.replacements.size).toBe(0)
  })

  test('journal : ajout d’un oubli à l’heure de Maurice, statistiques', async ({ page }) => {
    await page.goto('/journal')
    await page.getByRole('button', { name: 'Ajouter un remplacement oublié' }).click()
    await page.getByLabel('Date').fill('2026-10-12')
    await page.getByLabel('Heure').fill('01:30')
    await page.getByLabel('Note (facultative)').fill('oubli du week-end')
    await page.getByRole('button', { name: 'Enregistrer' }).click()

    await expect(page.getByText('oubli du week-end')).toBeVisible()
    await expect.poll(() => [...server.replacements.values()].map((r) => r.replaced_at)).toEqual(['2026-10-11T21:30:00.000Z'])
    await expect(page.getByText('Lundi 12 octobre 2026')).toBeVisible()
    await shot(page, 'journal')
  })
})
