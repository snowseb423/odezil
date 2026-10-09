import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attachDocumentOp,
  deleteDeliveryOp,
  deleteReplacementOp,
  recordReplacementOp,
  saveDeliveryOp,
  saveRepaymentOp,
  CommandError,
} from './commands.ts'
import { AppDB } from './db.ts'
import { FakeServer } from './fake-server.ts'
import { type AppData, loadAppData } from './mirror.ts'
import { SyncError } from './remote.ts'
import { SyncEngine } from './sync.ts'

/** Instant à une heure de Maurice (« 2026-10-03 08:00 »). */
const at = (mauritius: string) => new Date(`${mauritius.replace(' ', 'T')}:00+04:00`)

let db: AppDB
let server: FakeServer
let engine: SyncEngine
let counter = 0
let blocked: string[] = []

beforeEach(() => {
  db = new AppDB(`test-${++counter}`)
  server = new FakeServer()
  blocked = []
  engine = new SyncEngine(db, server, { retryDelays: [60_000], onBlocked: (b) => blocked.push(b.message) })
})

afterEach(async () => {
  engine.stop()
  await engine.whenIdle()
  db.close()
})

const data = (): Promise<AppData> => loadAppData(db)

async function commitAndSettle(op: Parameters<SyncEngine['commit']>[0]) {
  await engine.commit(op)
  await engine.whenIdle()
}

describe('file d’écritures hors ligne', () => {
  it('affiche la saisie immédiatement, puis l’envoie dans l’ordre au retour du réseau', async () => {
    server.online = false
    await engine.commit(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await engine.commit(recordReplacementOp(at('2026-10-07 08:00'), 'r2'))

    const offline = await data()
    expect(offline.replacements.map((r) => [r.id, r.pending])).toEqual([
      ['r2', true],
      ['r1', true],
    ])
    expect(offline.outbox).toHaveLength(2)
    expect(server.received).toEqual([])

    server.online = true
    await engine.sync()
    const online = await data()
    expect(server.received.map((op) => op.kind === 'replacement.upsert' && op.replacement.id)).toEqual(['r1', 'r2'])
    expect(online.outbox).toEqual([])
    expect(online.replacements.every((r) => !r.pending)).toBe(true)
    expect(online.hydrated).toBe(true)
  })

  it('rejeu idempotent : une réponse perdue puis renvoyée ne crée pas de doublon', async () => {
    server.loseNextResponse = true
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    // Appliqué côté serveur, mais la réponse est perdue : l'opération reste en file.
    expect(server.replacements.size).toBe(1)
    expect((await data()).outbox).toHaveLength(1)

    await engine.sync()
    expect(server.received).toHaveLength(2)
    expect(server.replacements.size).toBe(1)
    expect((await data()).outbox).toEqual([])
  })

  it('les remplacements partent toujours avant la livraison qui les rattache', async () => {
    await engine.sync() // première ouverture en ligne : prix connus
    server.online = false
    await engine.commit(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await engine.commit(recordReplacementOp(at('2026-10-05 08:00'), 'r2'))
    const { op } = saveDeliveryOp(await data(), { deliveryDate: '2026-10-14', bottlesTotal: 5 }, { id: 'd1' })
    await engine.commit(op)

    // Affichage hors ligne : attribution déjà visible.
    const offline = await data()
    expect(offline.deliveries[0]).toMatchObject({ id: 'd1', bottlesF1: 2, bottlesTotal: 5, unitPriceCentsApplied: 24_000, pending: true })
    expect(offline.replacements.map((r) => r.deliveryId)).toEqual(['d1', 'd1'])

    server.online = true
    await engine.sync()
    expect(server.received.map((o) => o.kind)).toEqual(['replacement.upsert', 'replacement.upsert', 'delivery.save'])
    expect(server.deliveries.get('d1')).toMatchObject({ bottlesF1: 2 })
    expect([...server.replacements.values()].map((r) => r.deliveryId)).toEqual(['d1', 'd1'])
    const online = await data()
    expect(online.deliveries[0]?.pending).toBeUndefined()
  })

  it('livraison et rattachements : tout ou rien, même après resynchronisation', async () => {
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    // Le remplacement est rattaché à une autre livraison côté serveur (saisie
    // faite ailleurs) : la livraison locale est refusée en bloc.
    server.deliveries.set('other', {
      id: 'other',
      deliveryDate: '2026-10-10',
      bottlesTotal: 1,
      bottlesF1: 1,
      unitPriceCentsApplied: 24_000,
      documentPath: null,
      note: null,
    })
    server.replacements.set('r1', { ...server.replacements.get('r1')!, deliveryId: 'other' })

    const { op } = saveDeliveryOp(await data(), { deliveryDate: '2026-10-14', bottlesTotal: 3 }, { id: 'd1' })
    await commitAndSettle(op)

    expect(server.deliveries.has('d1')).toBe(false)
    expect(server.replacements.get('r1')?.deliveryId).toBe('other')
    expect(engine.getState().blocked?.message).toMatch(/autre livraison/)
    expect(blocked).toHaveLength(1)
    // L'affichage garde la saisie en attente tant qu'elle n'est pas abandonnée.
    expect((await data()).deliveries.map((d) => d.id)).toContain('d1')

    await engine.discardBlocked()
    const after = await data()
    expect(after.deliveries.map((d) => d.id)).toEqual(['other'])
    expect(after.replacements[0]?.deliveryId).toBe('other')
    expect(engine.getState().blocked).toBeNull()
  })

  it('une opération refusée bloque la file : rien ne passe après elle avant Réessayer', async () => {
    server.failures.push(new SyncError('refus passager', 'rejected', 400))
    await engine.commit(saveRepaymentOp({ repaymentDate: '2026-10-20', amountCents: 50_000 }, null, 'p1'))
    await engine.commit(saveRepaymentOp({ repaymentDate: '2026-10-21', amountCents: 10_000 }, null, 'p2'))
    await engine.whenIdle()

    expect(server.repayments.size).toBe(0)
    expect(engine.getState().blocked).toMatchObject({ label: 'Remboursement du 2026-10-20', message: 'refus passager' })
    expect((await data()).outbox.map((e) => e.failed)).toEqual([true, false])

    await engine.retryBlocked()
    expect([...server.repayments.keys()]).toEqual(['p1', 'p2'])
    expect(engine.getState().blocked).toBeNull()
  })

  it('reprend après une coupure réseau, à partir de l’opération interrompue', async () => {
    // Le navigateur se croit en ligne mais le serveur ne répond pas.
    server.online = false
    await engine.commit(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await engine.commit(recordReplacementOp(at('2026-10-04 08:00'), 'r2'))
    await engine.whenIdle()

    const [first, second] = (await data()).outbox
    expect(first).toMatchObject({ attempts: expect.any(Number), lastError: 'Failed to fetch', failed: false })
    expect(first!.attempts).toBeGreaterThan(0)
    expect(second).toMatchObject({ attempts: 0, lastError: null })
    expect(engine.getState()).toMatchObject({ online: false, lastError: expect.stringMatching(/injoignable/) })

    server.online = true
    await engine.sync()
    expect(server.received.map((op) => op.kind === 'replacement.upsert' && op.replacement.id)).toEqual(['r1', 'r2'])
    expect((await data()).outbox).toEqual([])
    expect(engine.getState()).toMatchObject({ online: true, lastError: null })
  })

  it('session expirée : renouvelée puis rejeu, sinon reconnexion demandée', async () => {
    let refreshed = 0
    engine = new SyncEngine(db, server, {
      retryDelays: [60_000],
      refreshAuth: async () => {
        refreshed += 1
        return refreshed === 1
      },
    })
    server.failures.push(new SyncError('JWT expired', 'auth', 401))
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    expect(refreshed).toBe(1)
    expect(server.replacements.size).toBe(1)

    server.failures.push(new SyncError('JWT expired', 'auth', 401), new SyncError('JWT expired', 'auth', 401))
    await commitAndSettle(recordReplacementOp(at('2026-10-04 08:00'), 'r2'))
    expect(engine.getState().authRequired).toBe(true)
  })

  it('un document ajouté hors ligne ne se perd pas', async () => {
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await commitAndSettle(saveDeliveryOp(await data(), { deliveryDate: '2026-10-14', bottlesTotal: 2 }, { id: 'd1' }).op)

    server.online = false
    const blob = new Blob(['bon de livraison'], { type: 'image/jpeg' })
    const delivery = (await data()).deliveries[0]!
    await engine.commit(attachDocumentOp('delivery', delivery, { blob, contentType: 'image/jpeg', extension: 'jpg' }, 'doc-1'))

    const offline = (await data()).deliveries[0]!
    expect(offline.documentPath).toBe('deliveries/d1/doc-1.jpg')
    expect(offline.localDocument?.contentType).toBe('image/jpeg')
    expect(await offline.localDocument?.blob.text()).toBe('bon de livraison')

    // Rouvrir l'app (nouvelle instance de la base) : le document est toujours là.
    db.close()
    db = new AppDB(`test-${counter}`)
    engine = new SyncEngine(db, server, { retryDelays: [60_000] })
    expect((await data()).outbox).toHaveLength(1)

    server.online = true
    await engine.sync()
    expect(await server.storage.get('deliveries/d1/doc-1.jpg')?.text()).toBe('bon de livraison')
    expect(server.deliveries.get('d1')?.documentPath).toBe('deliveries/d1/doc-1.jpg')
    const synced = (await data()).deliveries[0]!
    expect(synced.localDocument).toBeUndefined()
    expect((await data()).outbox).toEqual([])
  })
})

describe('livraisons et remplacements', () => {
  it('supprimer une livraison remet ses remplacements en attente (local puis serveur)', async () => {
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await commitAndSettle(saveDeliveryOp(await data(), { deliveryDate: '2026-10-14', bottlesTotal: 2 }, { id: 'd1' }).op)
    expect((await data()).replacements[0]?.deliveryId).toBe('d1')

    server.online = false
    await engine.commit(deleteDeliveryOp((await data()).deliveries[0]!))
    expect((await data()).replacements[0]).toMatchObject({ deliveryId: null, pending: true })

    server.online = true
    await engine.sync()
    expect(server.replacements.get('r1')?.deliveryId).toBeNull()
    expect((await data()).deliveries).toEqual([])
  })

  it('un remplacement rattaché ne peut pas être supprimé', async () => {
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await commitAndSettle(saveDeliveryOp(await data(), { deliveryDate: '2026-10-14', bottlesTotal: 2 }, { id: 'd1' }).op)
    const replacement = (await data()).replacements[0]!
    expect(() => deleteReplacementOp(replacement)).toThrow(CommandError)
  })

  it('le prix figé par le serveur remplace l’estimation locale', async () => {
    await engine.sync()
    server.prices.set('p1', { id: 'p1', unitPriceCents: 25_000, effectiveFrom: '2026-10-01' })
    // Le téléphone ne connaît pas encore le nouveau prix (pas de relecture).
    const local = await data()
    const { op } = saveDeliveryOp(local, { deliveryDate: '2026-10-14', bottlesTotal: 1 }, { id: 'd1', confirmed: true })
    expect(op.kind === 'delivery.save' && op.unitPriceCents).toBe(24_000)
    await commitAndSettle(op)
    expect((await data()).deliveries[0]?.unitPriceCentsApplied).toBe(25_000)
  })

  it('le recalcul d’une livraison est une seule opération idempotente', async () => {
    await commitAndSettle(recordReplacementOp(at('2026-10-03 08:00'), 'r1'))
    await commitAndSettle(recordReplacementOp(at('2026-10-05 08:00'), 'r2'))
    await commitAndSettle(saveDeliveryOp(await data(), { deliveryDate: '2026-10-04', bottlesTotal: 3 }, { id: 'd1' }).op)
    expect(server.deliveries.get('d1')?.bottlesF1).toBe(1)

    const existing = (await data()).deliveries[0]!
    const { op, preview } = saveDeliveryOp(await data(), { deliveryDate: '2026-10-06', bottlesTotal: 3 }, { existing })
    expect(preview.before?.f2Cents).toBe(48_000)
    expect(preview.after.f2Cents).toBe(24_000)
    server.loseNextResponse = true
    await commitAndSettle(op)
    await engine.sync()
    expect(server.received.filter((o) => o.kind === 'delivery.save')).toHaveLength(3)
    expect(server.deliveries.get('d1')).toMatchObject({ deliveryDate: '2026-10-06', bottlesF1: 2 })
    expect([...server.replacements.values()].every((r) => r.deliveryId === 'd1')).toBe(true)
  })
})
