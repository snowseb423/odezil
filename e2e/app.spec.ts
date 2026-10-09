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

test.describe('livraisons', () => {
  test.beforeEach(async ({ context }) => {
    await server.signIn(context)
    // Trois remplacements du Foyer 1 déjà synchronisés.
    for (const [id, at] of [
      ['a1000000-0000-4000-8000-000000000001', '2026-10-02T04:00:00.000Z'],
      ['a1000000-0000-4000-8000-000000000002', '2026-10-06T04:00:00.000Z'],
      ['a1000000-0000-4000-8000-000000000003', '2026-10-09T04:00:00.000Z'],
    ] as const) {
      server.replacements.set(id, { id, replaced_at: at, note: null, delivery_id: null })
    }
  })

  test('nouvelle livraison : aperçu automatique, Foyer 2 = la différence, envoi atomique', async ({ page }) => {
    await page.goto('/livraisons')
    await page.getByRole('button', { name: 'Nouvelle livraison' }).click()
    const sheet = page.getByRole('dialog', { name: 'Nouvelle livraison' })
    await expect(sheet.getByText('(enregistrés)')).toBeVisible()
    // Total proposé = remplacements en attente ; on passe à 5.
    await sheet.getByRole('button', { name: 'Augmenter : total des bonbonnes' }).click()
    await sheet.getByRole('button', { name: 'Augmenter : total des bonbonnes' }).click()
    await expect(sheet.getByText('5 − 3 =')).toBeVisible()
    await expect(sheet.getByText('Rs\u00A0480,00')).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/nouvelle-livraison.png' })
    await sheet.getByRole('button', { name: 'Enregistrer la livraison' }).click()

    await expect.poll(() => server.rpcCalls.filter((c) => c.fn === 'save_delivery').length).toBe(1)
    const call = server.rpcCalls.find((c) => c.fn === 'save_delivery')!
    expect(call.args.p_replacement_ids).toEqual([
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000003',
    ])
    expect(call.args.p_delivery).toMatchObject({ delivery_date: '2026-10-14', bottles_total: 5 })
    await expect(page.getByText('Foyer 2 : 2')).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/livraisons.png', fullPage: true })
  })

  test('excédent reporté et confirmation quand aucun remplacement n’est enregistré', async ({ page }) => {
    await page.goto('/livraisons?nouvelle=1')
    const sheet = page.getByRole('dialog', { name: 'Nouvelle livraison' })
    await sheet.getByRole('button', { name: 'Diminuer : total des bonbonnes' }).click()
    await expect(sheet.getByText('1 remplacement reporté : plus de remplacements enregistrés que de bonbonnes livrées, vérifie tes saisies.')).toBeVisible()
    await sheet.getByLabel('Date de livraison').fill('2026-10-01')
    await expect(sheet.getByText('Aucun remplacement enregistré pour le Foyer 1')).toBeVisible()
    await sheet.getByRole('button', { name: 'Enregistrer la livraison' }).click()
    const confirm = page.getByRole('dialog', { name: 'Confirmer la livraison' })
    await expect(confirm.getByText('toutes les bonbonnes seront attribuées au Foyer 2')).toBeVisible()
    await confirm.getByRole('button', { name: 'Confirmer' }).click()
    await expect.poll(() => [...server.deliveries.values()].map((d) => [d.bottles_total, d.bottles_f1])).toEqual([[2, 0]])
  })

  test('recalcul avec aperçu avant/après, puis suppression : les remplacements repassent en attente', async ({ page }) => {
    server.deliveries.set('d1000000-0000-4000-8000-000000000001', {
      id: 'd1000000-0000-4000-8000-000000000001',
      delivery_date: '2026-10-07',
      bottles_total: 4,
      bottles_f1: 1,
      unit_price_cents_applied: 24_000,
      document_path: null,
      note: null,
    })
    server.replacements.set('a1000000-0000-4000-8000-000000000001', {
      ...server.replacements.get('a1000000-0000-4000-8000-000000000001')!,
      delivery_id: 'd1000000-0000-4000-8000-000000000001',
    })
    await page.goto('/livraisons')
    await page.getByRole('button', { name: /Mer\. 7 oct\./ }).click()
    const detail = page.getByRole('dialog', { name: 'Livraison du 7 octobre 2026' })
    await detail.getByRole('button', { name: 'Recalculer la répartition' }).click()
    const confirm = page.getByRole('dialog', { name: 'Recalculer la répartition ?' })
    await expect(confirm.getByText('Montant du Foyer 2')).toContainText('Rs\u00A0720,00')
    await expect(confirm.getByText('Montant du Foyer 2')).toContainText('Rs\u00A0480,00')
    await confirm.getByRole('button', { name: 'Recalculer' }).click()
    await expect.poll(() => server.deliveries.get('d1000000-0000-4000-8000-000000000001')?.bottles_f1).toBe(2)

    await detail.getByRole('button', { name: 'Supprimer la livraison' }).click()
    await page.getByRole('dialog', { name: 'Supprimer cette livraison ?' }).getByRole('button', { name: 'Supprimer' }).click()
    await expect.poll(() => server.deliveries.size).toBe(0)
    expect([...server.replacements.values()].every((r) => r.delivery_id === null)).toBe(true)
  })

  test('bon de livraison : ajout d’une photo, consultation par URL signée', async ({ page }) => {
    await page.goto('/livraisons?nouvelle=1')
    const sheet = page.getByRole('dialog', { name: 'Nouvelle livraison' })
    await sheet.locator('input[type=file]:not([capture])').setInputFiles({
      name: 'bon.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 bon de livraison'),
    })
    await expect(sheet.getByText('bon.pdf')).toBeVisible()
    await sheet.getByRole('button', { name: 'Enregistrer la livraison' }).click()
    await expect.poll(() => [...server.storage.keys()].filter((k) => k.startsWith('deliveries/')).length).toBe(1)
    const [path] = [...server.storage.keys()]
    expect(path).toMatch(/^deliveries\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/)
    await expect.poll(() => [...server.deliveries.values()][0]?.document_path).toBe(path)

    await page.getByRole('button', { name: /Mer\. 14 oct\./ }).click()
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Voir' }).click()
    await (await popup).waitForURL(/\/storage\/v1\/object\/public-e2e\/deliveries\//)
  })
})

test.describe('rapprochement SOA', () => {
  test.beforeEach(async ({ context }) => {
    await server.signIn(context)
    server.deliveries.set('d9000000-0000-4000-8000-000000000001', {
      id: 'd9000000-0000-4000-8000-000000000001',
      delivery_date: '2026-09-15',
      bottles_total: 5,
      bottles_f1: 2,
      unit_price_cents_applied: 24_000,
      document_path: null,
      note: null,
    })
  })

  test('écart non nul : traitement obligatoire, puis enregistré avec le document du SOA', async ({ page }) => {
    await page.goto('/mois')
    await expect(page.getByText('Septembre 2026')).toBeVisible()
    await page.getByRole('button', { name: 'Saisir un SOA' }).click()
    const sheet = page.getByRole('dialog', { name: 'Saisir un SOA' })
    await expect(sheet.getByLabel('Mois')).toHaveValue('2026-09')
    await sheet.getByLabel('Total du SOA (Rs)').fill('1 210,01')
    await expect(sheet.getByText('+Rs\u00A010,01', { exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Enregistrer le SOA' })).toBeDisabled()
    await expect(sheet.getByText('Choisissez un traitement pour valider.')).toBeVisible()
    await sheet.getByText('Partager 50/50').click()
    await sheet.locator('input[type=file]:not([capture])').setInputFiles({
      name: 'soa-septembre.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 SOA'),
    })
    await page.screenshot({ path: 'test-results/screens/soa.png' })
    await sheet.getByRole('button', { name: 'Enregistrer le SOA' }).click()

    await expect.poll(() => [...server.soas.values()].map((s) => [s.month, s.total_billed_cents, s.variance_cents, s.variance_treatment])).toEqual([
      ['2026-09-01', 121_001, 1_001, 'split_50_50'],
    ])
    await expect.poll(() => [...server.storage.keys()].some((k) => /^soa\/2026-09\/[0-9a-f-]{36}\.pdf$/.test(k))).toBe(true)
    await expect(page.getByText('Écart traité')).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/mois.png', fullPage: true })
  })

  test('SOA conforme : rapproché sans traitement', async ({ page }) => {
    await page.goto('/mois')
    await page.getByRole('button', { name: 'Saisir un SOA' }).click()
    const sheet = page.getByRole('dialog', { name: 'Saisir un SOA' })
    await sheet.getByLabel('Total du SOA (Rs)').fill('1200')
    await expect(sheet.getByText('Traitement de l’écart')).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Enregistrer le SOA' }).click()
    await expect(page.getByText('Rapproché', { exact: true })).toBeVisible()
    await expect.poll(() => [...server.soas.values()].map((s) => [s.variance_cents, s.variance_treatment])).toEqual([[0, 'pending']])
  })
})

test.describe('solde et remboursements', () => {
  test.beforeEach(async ({ context }) => {
    await server.signIn(context)
    server.deliveries.set('d9000000-0000-4000-8000-000000000001', {
      id: 'd9000000-0000-4000-8000-000000000001',
      delivery_date: '2026-09-15',
      bottles_total: 5,
      bottles_f1: 2,
      unit_price_cents_applied: 24_000,
      document_path: null,
      note: null,
    })
    server.deliveries.set('d9000000-0000-4000-8000-000000000002', {
      id: 'd9000000-0000-4000-8000-000000000002',
      delivery_date: '2026-10-02',
      bottles_total: 4,
      bottles_f1: 2,
      unit_price_cents_applied: 24_000,
      document_path: null,
      note: null,
    })
  })

  test('remboursements partiels : le solde reste juste', async ({ page }) => {
    await page.goto('/solde')
    await expect(page.getByTestId('balance')).toHaveText('Rs\u00A01\u202F200,00')
    await page.getByRole('button', { name: 'Enregistrer un remboursement' }).click()
    const sheet = page.getByRole('dialog', { name: 'Remboursement reçu' })
    await sheet.getByLabel('Montant (Rs)').fill('500')
    await sheet.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByTestId('balance')).toHaveText('Rs\u00A0700,00')
    await expect.poll(() => [...server.repayments.values()].map((r) => r.amount_cents)).toEqual([50_000])
    await page.screenshot({ path: 'test-results/screens/solde.png', fullPage: true })

    await page.getByRole('button', { name: /Mer\. 14 oct\./ }).click()
    await page.getByRole('dialog', { name: 'Modifier le remboursement' }).getByRole('button', { name: 'Supprimer' }).click()
    await page.getByRole('dialog', { name: 'Supprimer ce remboursement ?' }).getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.getByTestId('balance')).toHaveText('Rs\u00A01\u202F200,00')
    await expect.poll(() => server.repayments.size).toBe(0)
  })

  test('message récapitulatif prêt pour WhatsApp, copié en un appui', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    server.repayments.set('r9000000-0000-4000-8000-000000000001', {
      id: 'r9000000-0000-4000-8000-000000000001',
      repayment_date: '2026-09-30',
      amount_cents: 20_000,
      note: null,
    })
    await page.goto('/solde')
    await page.getByRole('button', { name: 'Message récapitulatif' }).click()
    const sheet = page.getByRole('dialog', { name: 'Message récapitulatif' })
    await expect(sheet.getByLabel('Mois')).toHaveValue('2026-09')
    const expected =
      'Bonjour, récap eau de septembre 2026 : 3 bonbonnes × Rs\u00A0240,00 = Rs\u00A0720,00. ' +
      'Solde antérieur : −Rs\u00A0200,00. Total à régler : Rs\u00A0520,00. Merci !'
    await expect(sheet.getByLabel('Texte du message')).toHaveValue(expected)
    await sheet.getByRole('button', { name: 'Copier' }).click()
    await expect(page.getByText('Message copié')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected)

    await sheet.getByLabel('Mois').selectOption('2026-10')
    await expect(sheet.getByLabel('Texte du message')).toHaveValue(
      'Bonjour, récap eau d’octobre 2026 : 2 bonbonnes × Rs\u00A0240,00 = Rs\u00A0480,00. ' +
        'Solde antérieur : Rs\u00A0520,00. Total à régler : Rs\u00A01\u202F000,00. Merci !',
    )
  })
})
