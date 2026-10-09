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

test.describe('page du Foyer 2', () => {
  const TOKEN = 'k3J9xQ2mV7pL0sN4tR8wY1zA6bC5dE3fG2hJ9kL0mN8'

  test.beforeEach(() => {
    server.deliveries.set('d9000000-0000-4000-8000-000000000001', {
      id: 'd9000000-0000-4000-8000-000000000001',
      delivery_date: '2026-09-15',
      bottles_total: 5,
      bottles_f1: 2,
      unit_price_cents_applied: 24_000,
      document_path: 'deliveries/d9000000-0000-4000-8000-000000000001/x.jpg',
      note: 'NOTE-FOYER-1',
    })
    // Livraison propre au Foyer 1 : invisible pour le Foyer 2.
    server.deliveries.set('d9000000-0000-4000-8000-000000000002', {
      id: 'd9000000-0000-4000-8000-000000000002',
      delivery_date: '2026-10-02',
      bottles_total: 2,
      bottles_f1: 2,
      unit_price_cents_applied: 24_000,
      document_path: null,
      note: null,
    })
    server.soas.set('s9000000-0000-4000-8000-000000000001', {
      id: 's9000000-0000-4000-8000-000000000001',
      month: '2026-09-01',
      total_billed_cents: 121_001,
      variance_cents: 1_001,
      variance_treatment: 'split_50_50',
      document_path: null,
      note: null,
    })
    server.repayments.set('r9000000-0000-4000-8000-000000000001', {
      id: 'r9000000-0000-4000-8000-000000000001',
      repayment_date: '2026-10-05',
      amount_cents: 20_000,
      note: 'NOTE-REMBOURSEMENT',
    })
    server.seedShareLink(TOKEN)
  })

  test('lecture seule, uniquement ses données, rien de stocké sur l’appareil', async ({ page }) => {
    await page.goto(`/p/${TOKEN}`)
    await expect(page.getByTestId('shared-balance')).toHaveText('Rs\u00A0525,00')
    await expect(page.getByText('3 bonbonnes × Rs\u00A0240,00 =')).toBeVisible()
    await expect(page.getByText('Ajustement (relevé Odezil)')).toBeVisible()
    await expect(page.getByText(/Dernière mise à jour/)).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/foyer-2.png', fullPage: true })

    const text = await page.locator('body').innerText()
    for (const secret of ['Foyer 1', 'NOTE-FOYER-1', 'NOTE-REMBOURSEMENT', '2 oct', '1\u202F210,01', 'Total']) {
      expect(text).not.toContain(secret)
    }
    // Aucune saisie possible : un seul bouton, « Actualiser ».
    await expect(page.getByRole('button')).toHaveText(['Actualiser'])
    // Ni session, ni base locale de l'administrateur.
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual([])
    expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')
    // Le token ne part jamais dans une URL (corps de la requête RPC uniquement).
    expect(server.rpcCalls.map((c) => c.fn)).toContain('get_shared_view')
  })

  test('« Actualiser » relit les données', async ({ page }) => {
    await page.goto(`/p/${TOKEN}`)
    await expect(page.getByTestId('shared-balance')).toHaveText('Rs\u00A0525,00')
    server.repayments.set('r9000000-0000-4000-8000-000000000002', {
      id: 'r9000000-0000-4000-8000-000000000002',
      repayment_date: '2026-10-14',
      amount_cents: 52_500,
      note: null,
    })
    await page.getByRole('button', { name: 'Actualiser' }).click()
    await expect(page.getByTestId('shared-balance')).toHaveText('Rs\u00A00,00')
    await expect(page.getByText('Tout est réglé. Merci !')).toBeVisible()
  })

  test('lien inconnu ou révoqué : page générique « Lien invalide »', async ({ page }) => {
    await page.goto('/p/Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3Nn4')
    await expect(page.getByRole('heading', { name: 'Lien invalide' })).toBeVisible()
    await expect(page.getByText('Rs')).toHaveCount(0)
  })

  test('l’administrateur génère un lien, affiché une seule fois, puis le révoque', async ({ page, context }) => {
    await server.signIn(context)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    server.shareLinks = []
    await page.goto('/reglages')
    await page.getByRole('button', { name: 'Générer le lien' }).click()
    const sheet = page.getByRole('dialog', { name: 'Nouveau lien du Foyer 2' })
    const url = await sheet.getByLabel('Lien complet').inputValue()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4174\/p\/[A-Za-z0-9_-]{43}$/)
    await sheet.getByRole('button', { name: 'Copier' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url)
    // Seul le hash du token est envoyé au serveur.
    const token = url.split('/p/')[1]!
    const sent = server.rpcCalls.find((c) => c.fn === 'rotate_share_link')!.args
    expect(JSON.stringify(sent)).not.toContain(token)
    expect(server.sharedView(token)).not.toBeNull()
    await sheet.getByRole('button', { name: 'Fermer' }).click()
    await expect(page.getByText(/Lien actif depuis le/)).toBeVisible()
    await expect(page.getByLabel('Lien complet')).toHaveCount(0)

    await page.getByRole('button', { name: 'Révoquer le lien' }).click()
    await page.getByRole('dialog', { name: 'Révoquer le lien ?' }).getByRole('button', { name: 'Révoquer' }).click()
    await expect(page.getByText('Aucun lien actif')).toBeVisible()
    expect(server.sharedView(token)).toBeNull()
  })
})

test.describe('historique', () => {
  test.beforeEach(async ({ context }) => {
    await server.signIn(context)
    server.deliveries.set('d9000000-0000-4000-8000-000000000001', {
      id: 'd9000000-0000-4000-8000-000000000001',
      delivery_date: '2026-09-15',
      bottles_total: 5,
      bottles_f1: 2,
      unit_price_cents_applied: 24_000,
      document_path: 'deliveries/d9000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001.jpg',
      note: null,
    })
    server.storage.set('deliveries/d9000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001.jpg', Buffer.from('jpeg'))
  })

  test('documents du mois et export CSV', async ({ page }) => {
    await page.goto('/mois')
    await page.getByRole('button', { name: /Septembre 2026/ }).click()
    const detail = page.getByRole('dialog', { name: 'Septembre 2026' })
    await expect(detail.getByText('Bon du mar. 15 sept.')).toBeVisible()
    const popup = page.waitForEvent('popup')
    await detail.getByRole('button', { name: 'Voir' }).click()
    await (await popup).waitForURL(/public-e2e\/deliveries\//)
    await detail.getByRole('button', { name: 'Fermer' }).click()

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Historique mensuel (CSV)' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('eaupartagee-historique-2026-10-14.csv')
    const content = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8')
    expect(content).toContain('2026-09;1;5;2;3;480,00;720,00;1200,00;;;;0,00;SOA à saisir')
  })
})

test.describe('connexion', () => {
  test('« Se connecter avec Google » : aller-retour PKCE, vérification is_admin, l’app s’ouvre', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/connexion.png' })
    await page.getByRole('button', { name: 'Se connecter avec Google' }).click()

    await expect(page.getByRole('button', { name: /Bonbonne remplacée/ })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    expect(page.url()).not.toContain('code=')
    const [authorize] = server.authorizeUrls
    expect(Object.fromEntries(authorize!.searchParams)).toMatchObject({
      provider: 'google',
      redirect_to: 'http://127.0.0.1:4174/auth/callback',
      prompt: 'select_account',
      code_challenge_method: 's256',
    })
    expect(server.rpcCalls.map((c) => c.fn)).toContain('is_admin')
  })

  test('compte Google non autorisé : refusé par la garde d’inscription, message clair', async ({ page }) => {
    server.googleEmail = 'intrus@example.com'
    await page.goto('/')
    await page.getByRole('button', { name: 'Se connecter avec Google' }).click()
    await expect(page.getByRole('alert')).toHaveText('Accès non autorisé : ce compte ne peut pas utiliser EauPartagée.')
    await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible()
  })

  test('session valide mais is_admin() faux : déconnexion immédiate et données effacées', async ({ page }) => {
    server.admin = false
    await page.goto('/')
    await page.getByRole('button', { name: 'Se connecter avec Google' }).click()
    await expect(page.getByRole('alert')).toHaveText('Accès non autorisé : ce compte ne peut pas utiliser EauPartagée.')
    expect(await page.evaluate(() => localStorage.getItem('eaupartagee-auth'))).toBeNull()
    expect(server.replacements.size).toBe(0)
  })

  test('lien par email et code à 6 chiffres', async ({ page }) => {
    server.google = false
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Se connecter avec Google' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Recevoir un lien par email' }).click()
    await expect(page.getByLabel('Votre adresse email')).toHaveValue('admin@example.com')
    await page.getByRole('button', { name: 'Recevoir le lien et le code' }).click()
    await page.getByLabel('Code reçu par email').fill('123456')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('button', { name: /Bonbonne remplacée/ })).toBeVisible()
  })
})

test.describe('interface à 375 px', () => {
  test('pas de défilement horizontal, cibles tactiles d’au moins 44 px', async ({ page, context }) => {
    await server.signIn(context)
    server.replacements.set('a1000000-0000-4000-8000-000000000001', {
      id: 'a1000000-0000-4000-8000-000000000001',
      replaced_at: '2026-10-02T04:00:00.000Z',
      note: 'une note assez longue pour vérifier que rien ne déborde à 375 pixels de large',
      delivery_id: null,
    })
    for (const [path, marker] of [
      ['/', 'Derniers remplacements'],
      ['/journal', 'Consommation par mois'],
      ['/livraisons', 'Livraisons enregistrées'],
      ['/mois', 'Historique'],
      ['/solde', 'Détail du solde'],
      ['/reglages', 'Prix d’une bonbonne'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: marker })).toBeVisible()
      const audit = await page.evaluate(() => {
        const small: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary')) {
          const rect = el.getBoundingClientRect()
          if (!rect.width || !rect.height || el.closest('dialog:not([open])') || el.getAttribute('aria-hidden') === 'true') continue
          if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'file')) continue
          if (rect.width < 43.5 || rect.height < 43.5) small.push(`${el.tagName} « ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim()} » ${rect.width}×${rect.height}`)
        }
        return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, small }
      })
      expect(audit.overflow, `défilement horizontal sur ${path}`).toBe(false)
      expect(audit.small, `petites cibles sur ${path}`).toEqual([])
    }
  })
})
