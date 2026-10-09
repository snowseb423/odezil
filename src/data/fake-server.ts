// Serveur en mémoire pour les tests : mêmes règles que la base (verrou des
// remplacements rattachés, save_delivery atomique et idempotente, prix figé,
// suppression d'une livraison → remplacements en attente).
import { priceAt } from '../domain/calculations.ts'
import { mauritiusDateOf } from '../domain/dates.ts'
import type { Delivery, Price, Replacement, Repayment, SoaStatement } from '../domain/types.ts'
import type { ShareLink } from './db.ts'
import type { Op } from './ops.ts'
import { type OpResult, type Remote, type Snapshot, SyncError } from './remote.ts'

const rejected = (message: string) => new SyncError(message, 'rejected', 409)
const copy = <T>(map: Map<string, T>) => [...map.values()].map((row) => ({ ...row }))

export class FakeServer implements Remote {
  prices = new Map<string, Price>([['p0', { id: 'p0', unitPriceCents: 24_000, effectiveFrom: '2000-01-01' }]])
  replacements = new Map<string, Replacement>()
  deliveries = new Map<string, Delivery>()
  soas = new Map<string, SoaStatement>()
  repayments = new Map<string, Repayment>()
  shareLinks = new Map<string, ShareLink>()
  storage = new Map<string, Blob>()

  online = true
  /** Opérations reçues (dans l'ordre), y compris celles refusées. */
  received: Op[] = []
  /** Erreurs à renvoyer aux prochains appels, avant tout traitement. */
  failures: SyncError[] = []
  /** Applique l'opération puis « perd » la réponse (coupure réseau). */
  loseNextResponse = false
  fetches = 0

  async execute(op: Op): Promise<OpResult> {
    if (!this.online) throw new SyncError('Failed to fetch', 'network')
    const failure = this.failures.shift()
    if (failure) throw failure
    this.received.push(op)
    const result = this.apply(op)
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new SyncError('Failed to fetch', 'network')
    }
    return result
  }

  private apply(op: Op): OpResult {
    switch (op.kind) {
      case 'replacement.upsert': {
        const current = this.replacements.get(op.replacement.id)
        if (current?.deliveryId && (current.replacedAt !== op.replacement.replacedAt || current.note !== op.replacement.note)) {
          throw rejected('Remplacement rattaché à une livraison : il ne peut pas être modifié.')
        }
        this.replacements.set(op.replacement.id, { ...op.replacement, deliveryId: current?.deliveryId ?? null })
        return {}
      }
      case 'replacement.delete': {
        if (this.replacements.get(op.id)?.deliveryId) throw rejected('Remplacement rattaché à une livraison : il ne peut pas être supprimé.')
        this.replacements.delete(op.id)
        return {}
      }
      case 'delivery.save': {
        const { delivery, replacementIds } = op
        if (new Set(replacementIds).size !== replacementIds.length) throw rejected('Doublon')
        if (replacementIds.length > delivery.bottlesTotal) throw rejected('bottles_f2 négatif')
        for (const id of replacementIds) {
          const replacement = this.replacements.get(id)
          if (!replacement) throw rejected('Remplacement inconnu : synchronisez puis recommencez.')
          if (replacement.deliveryId && replacement.deliveryId !== delivery.id) throw rejected('Déjà rattaché à une autre livraison.')
          if (mauritiusDateOf(replacement.replacedAt) > delivery.deliveryDate) throw rejected('Remplacement postérieur à la livraison.')
        }
        const current = this.deliveries.get(delivery.id)
        const price =
          current && current.deliveryDate === delivery.deliveryDate ? current.unitPriceCentsApplied : priceAt(delivery.deliveryDate, [...this.prices.values()])
        if (price === null) throw rejected('Aucun prix unitaire en vigueur.')
        const saved: Delivery = {
          id: delivery.id,
          deliveryDate: delivery.deliveryDate,
          bottlesTotal: delivery.bottlesTotal,
          bottlesF1: replacementIds.length,
          unitPriceCentsApplied: price,
          documentPath: current?.documentPath ?? null,
          note: delivery.note,
        }
        this.deliveries.set(delivery.id, saved)
        for (const [id, replacement] of this.replacements) {
          const attach = replacementIds.includes(id)
          if (attach && replacement.deliveryId !== delivery.id) this.replacements.set(id, { ...replacement, deliveryId: delivery.id })
          if (!attach && replacement.deliveryId === delivery.id) this.replacements.set(id, { ...replacement, deliveryId: null })
        }
        return { delivery: { ...saved } }
      }
      case 'delivery.delete': {
        this.deliveries.delete(op.id)
        for (const [id, replacement] of this.replacements) {
          if (replacement.deliveryId === op.id) this.replacements.set(id, { ...replacement, deliveryId: null })
        }
        if (op.documentPath) this.storage.delete(op.documentPath)
        return {}
      }
      case 'document.attach': {
        const table = op.target === 'delivery' ? this.deliveries : this.soas
        const current = table.get(op.targetId)
        this.storage.set(op.path, op.blob)
        if (current) table.set(op.targetId, { ...current, documentPath: op.path } as never)
        if (op.previousPath && op.previousPath !== op.path) this.storage.delete(op.previousPath)
        return {}
      }
      case 'document.detach': {
        const table = op.target === 'delivery' ? this.deliveries : this.soas
        const current = table.get(op.targetId)
        if (current) table.set(op.targetId, { ...current, documentPath: null } as never)
        this.storage.delete(op.path)
        return {}
      }
      case 'soa.save': {
        const other = [...this.soas.values()].find((s) => s.month === op.soa.month && s.id !== op.soa.id)
        if (other) throw rejected('soa_statements_month_key')
        this.soas.set(op.soa.id, { ...op.soa, documentPath: this.soas.get(op.soa.id)?.documentPath ?? null })
        return {}
      }
      case 'soa.delete': {
        const current = this.soas.get(op.id)
        this.soas.delete(op.id)
        if (current?.documentPath) this.storage.delete(current.documentPath)
        return {}
      }
      case 'repayment.save':
        this.repayments.set(op.repayment.id, { ...op.repayment })
        return {}
      case 'repayment.delete':
        this.repayments.delete(op.id)
        return {}
      case 'price.save':
        this.prices.set(op.price.id, { ...op.price })
        return {}
      case 'price.delete':
        this.prices.delete(op.id)
        return {}
    }
  }

  async fetchAll(): Promise<Snapshot> {
    if (!this.online) throw new SyncError('Failed to fetch', 'network')
    this.fetches += 1
    return {
      prices: copy(this.prices),
      replacements: copy(this.replacements),
      deliveries: copy(this.deliveries),
      soas: copy(this.soas),
      repayments: copy(this.repayments),
      shareLinks: copy(this.shareLinks),
    }
  }
}
