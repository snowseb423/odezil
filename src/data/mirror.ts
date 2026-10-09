// Lecture et écriture du miroir local (Dexie). L'état affiché combine le
// miroir serveur et les opérations encore dans la file.
import type { AppDB, MetaRow, MirrorTable, OutboxEntry, ShareLink } from './db.ts'
import { MIRROR_TABLES } from './db.ts'
import {
  type EffectiveDelivery,
  type EffectivePrice,
  type EffectiveReplacement,
  type EffectiveRepayment,
  type EffectiveSoa,
  type MirrorState,
  type Op,
  applyOp,
  applyOps,
} from './ops.ts'
import type { OpResult, Snapshot } from './remote.ts'

export interface AppData {
  prices: EffectivePrice[]
  replacements: EffectiveReplacement[]
  deliveries: EffectiveDelivery[]
  soas: EffectiveSoa[]
  repayments: EffectiveRepayment[]
  shareLink: ShareLink | null
  outbox: OutboxEntry[]
  /** Au moins une lecture complète du serveur a eu lieu sur cet appareil. */
  hydrated: boolean
}

function mirrorTables(db: AppDB) {
  return MIRROR_TABLES.map((table) => db.table(table))
}

export async function loadMirror(db: AppDB): Promise<MirrorState> {
  const [prices, replacements, deliveries, soas, repayments, shareLinks] = await Promise.all([
    db.prices.toArray(),
    db.replacements.toArray(),
    db.deliveries.toArray(),
    db.soas.toArray(),
    db.repayments.toArray(),
    db.shareLinks.toArray(),
  ])
  return {
    prices: new Map(prices.map((row) => [row.id, row])),
    replacements: new Map(replacements.map((row) => [row.id, row])),
    deliveries: new Map(deliveries.map((row) => [row.id, row])),
    soas: new Map(soas.map((row) => [row.id, row])),
    repayments: new Map(repayments.map((row) => [row.id, row])),
    shareLinks: new Map(shareLinks.map((row) => [row.id, row])),
  }
}

/** Données affichées : miroir + opérations en attente, triées pour l'interface. */
export async function loadAppData(db: AppDB): Promise<AppData> {
  const [mirror, outbox, lastPull] = await Promise.all([loadMirror(db), db.outbox.orderBy('id').toArray(), db.meta.get('lastPullAt')])
  const state = applyOps(
    mirror,
    outbox.map((entry) => entry.op),
  )
  return {
    prices: [...state.prices.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
    replacements: [...state.replacements.values()].sort((a, b) => Date.parse(b.replacedAt) - Date.parse(a.replacedAt) || b.id.localeCompare(a.id)),
    deliveries: [...state.deliveries.values()].sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || b.id.localeCompare(a.id)),
    soas: [...state.soas.values()].sort((a, b) => b.month.localeCompare(a.month)),
    repayments: [...state.repayments.values()].sort((a, b) => b.repaymentDate.localeCompare(a.repaymentDate) || b.id.localeCompare(a.id)),
    shareLink: [...state.shareLinks.values()][0] ?? null,
    outbox,
    hydrated: Boolean(lastPull),
  }
}

/** Écrit dans Dexie les entrées qui ont changé entre deux états (comparaison par référence). */
async function writeDiff(db: AppDB, before: MirrorState, after: MirrorState): Promise<void> {
  for (const table of MIRROR_TABLES) {
    const previous = before[table] as Map<string, unknown>
    const next = after[table] as Map<string, unknown>
    if (previous === next) continue
    const store = db.table(table)
    const removed = [...previous.keys()].filter((key) => !next.has(key))
    const changed = [...next.entries()].filter(([key, value]) => previous.get(key) !== value).map(([, value]) => value)
    if (removed.length) await store.bulkDelete(removed)
    if (changed.length) await store.bulkPut(changed)
  }
}

/**
 * Opération confirmée par le serveur : elle est retirée de la file et son
 * effet est reporté dans le miroir, dans la même transaction.
 */
export async function confirmOp(db: AppDB, entry: OutboxEntry, result: OpResult): Promise<void> {
  await db.transaction('rw', [db.outbox, ...mirrorTables(db)], async () => {
    const before = await loadMirror(db)
    const after = applyOp(before, entry.op, { confirmed: result.delivery ? { delivery: result.delivery } : {} })
    await writeDiff(db, before, after)
    await db.outbox.delete(entry.id!)
  })
}

/** Remplace tout le miroir par l'instantané du serveur. */
export async function replaceMirror(db: AppDB, snapshot: Snapshot, at: string): Promise<void> {
  await db.transaction('rw', [...mirrorTables(db), db.meta], async () => {
    for (const table of MIRROR_TABLES) {
      const store = db.table(table)
      await store.clear()
      await store.bulkPut(snapshot[table as MirrorTable] as unknown[])
    }
    await db.meta.put({ key: 'lastPullAt', value: at } satisfies MetaRow)
  })
}

/** Ajoute une opération en fin de file (jamais de fusion : l'ordre fait foi). */
export async function enqueue(db: AppDB, op: Op): Promise<number> {
  return (await db.outbox.add({ op, createdAt: new Date().toISOString(), attempts: 0, lastError: null, failed: false })) as number
}

/** Déconnexion ou refus d'accès : efface toutes les données locales. */
export async function clearAll(db: AppDB): Promise<void> {
  await db.transaction('rw', [...mirrorTables(db), db.outbox, db.meta], async () => {
    for (const table of [...MIRROR_TABLES, 'outbox', 'meta']) await db.table(table).clear()
  })
}
