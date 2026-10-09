// Opérations d'écriture mises en file (outbox) puis rejouées vers Supabase,
// dans l'ordre et sans fusion. Module pur : l'état affiché = miroir serveur
// + opérations en attente appliquées par-dessus, avec la même sémantique
// que la base (rattachement, suppression d'une livraison → remplacements
// en attente, prix figé sauf changement de date).
import type { Delivery, IsoDate, Price, Replacement, Repayment, SoaStatement } from '../domain/types.ts'
import type { ShareLink } from './db.ts'

export type DocumentTarget = 'delivery' | 'soa'

export type Op =
  | { kind: 'replacement.upsert'; replacement: Pick<Replacement, 'id' | 'replacedAt' | 'note'> }
  | { kind: 'replacement.delete'; id: string }
  | {
      kind: 'delivery.save'
      delivery: Pick<Delivery, 'id' | 'deliveryDate' | 'bottlesTotal' | 'note'>
      /** Remplacements rattachés (attribution calculée localement). */
      replacementIds: string[]
      /** Prix estimé localement (le serveur le fige lui-même). */
      unitPriceCents: number
    }
  | { kind: 'delivery.delete'; id: string; documentPath: string | null }
  | {
      kind: 'document.attach'
      target: DocumentTarget
      targetId: string
      path: string
      /** Le fichier lui-même, conservé dans la file jusqu'à l'envoi. */
      blob: Blob
      contentType: string
      previousPath: string | null
    }
  | { kind: 'document.detach'; target: DocumentTarget; targetId: string; path: string }
  | { kind: 'soa.save'; soa: Omit<SoaStatement, 'documentPath'> }
  | { kind: 'soa.delete'; id: string; documentPath: string | null }
  | { kind: 'repayment.save'; repayment: Repayment }
  | { kind: 'repayment.delete'; id: string }
  | { kind: 'price.save'; price: Price }
  | { kind: 'price.delete'; id: string }

/** Marque d'une donnée modifiée localement, pas encore confirmée par le serveur. */
export interface PendingMark {
  pending?: boolean
}

/** Document ajouté hors ligne : affiché depuis le Blob local en attendant l'envoi. */
export interface LocalDocument {
  localDocument?: { blob: Blob; contentType: string } | null
}

export type EffectiveReplacement = Replacement & PendingMark
export type EffectiveDelivery = Delivery & PendingMark & LocalDocument
export type EffectiveSoa = SoaStatement & PendingMark & LocalDocument
export type EffectiveRepayment = Repayment & PendingMark
export type EffectivePrice = Price & PendingMark

export interface MirrorState {
  prices: Map<string, EffectivePrice>
  replacements: Map<string, EffectiveReplacement>
  deliveries: Map<string, EffectiveDelivery>
  soas: Map<string, EffectiveSoa>
  repayments: Map<string, EffectiveRepayment>
  shareLinks: Map<string, ShareLink>
}

export function emptyMirror(): MirrorState {
  return {
    prices: new Map(),
    replacements: new Map(),
    deliveries: new Map(),
    soas: new Map(),
    repayments: new Map(),
    shareLinks: new Map(),
  }
}

export interface ApplyOptions {
  /**
   * Opération confirmée par le serveur : pas de marque « en attente », et
   * la livraison renvoyée par save_delivery() (prix figé par la base)
   * remplace l'estimation locale.
   */
  confirmed?: { delivery?: Delivery }
}

function copyState(state: MirrorState): MirrorState {
  return {
    prices: new Map(state.prices),
    replacements: new Map(state.replacements),
    deliveries: new Map(state.deliveries),
    soas: new Map(state.soas),
    repayments: new Map(state.repayments),
    shareLinks: state.shareLinks,
  }
}

/** Applique une opération sur un état (copie modifiée ; les entrées inchangées gardent leur référence). */
export function applyOp(state: MirrorState, op: Op, options: ApplyOptions = {}): MirrorState {
  const next = copyState(state)
  const mark: PendingMark = options.confirmed ? {} : { pending: true }

  switch (op.kind) {
    case 'replacement.upsert': {
      const current = next.replacements.get(op.replacement.id)
      // Un remplacement rattaché est verrouillé (comme le trigger SQL).
      if (current?.deliveryId) break
      next.replacements.set(op.replacement.id, { ...op.replacement, deliveryId: current?.deliveryId ?? null, ...mark })
      break
    }
    case 'replacement.delete': {
      if (next.replacements.get(op.id)?.deliveryId) break
      next.replacements.delete(op.id)
      break
    }
    case 'delivery.save': {
      const current = next.deliveries.get(op.delivery.id)
      const server = options.confirmed?.delivery
      if (server) {
        next.deliveries.set(op.delivery.id, server)
      } else {
        next.deliveries.set(op.delivery.id, {
          id: op.delivery.id,
          deliveryDate: op.delivery.deliveryDate,
          bottlesTotal: op.delivery.bottlesTotal,
          bottlesF1: op.replacementIds.length,
          // Comme le trigger SQL : prix figé, sauf si la date change.
          unitPriceCentsApplied:
            current && current.deliveryDate === op.delivery.deliveryDate ? current.unitPriceCentsApplied : op.unitPriceCents,
          documentPath: current?.documentPath ?? null,
          note: op.delivery.note,
          ...(current?.localDocument ? { localDocument: current.localDocument } : {}),
          ...mark,
        })
      }
      const attached = new Set(op.replacementIds)
      for (const [id, replacement] of next.replacements) {
        if (replacement.deliveryId === op.delivery.id && !attached.has(id)) {
          next.replacements.set(id, { ...replacement, deliveryId: null, ...mark })
        }
      }
      for (const id of attached) {
        const replacement = next.replacements.get(id)
        if (replacement && replacement.deliveryId !== op.delivery.id) {
          next.replacements.set(id, { ...replacement, deliveryId: op.delivery.id, ...mark })
        }
      }
      break
    }
    case 'delivery.delete': {
      next.deliveries.delete(op.id)
      // Comme « on delete set null » : ses remplacements repassent en attente.
      for (const [id, replacement] of next.replacements) {
        if (replacement.deliveryId === op.id) next.replacements.set(id, { ...replacement, deliveryId: null, ...mark })
      }
      break
    }
    case 'document.attach':
    case 'document.detach': {
      const documentPath = op.kind === 'document.attach' ? op.path : null
      const localDocument = op.kind === 'document.attach' ? { blob: op.blob, contentType: op.contentType } : null
      const current = op.target === 'delivery' ? next.deliveries.get(op.targetId) : next.soas.get(op.targetId)
      if (!current) break
      const { pending: _pending, localDocument: _local, ...base } = current
      const updated = options.confirmed ? { ...base, documentPath } : { ...base, documentPath, localDocument, pending: true }
      if (op.target === 'delivery') next.deliveries.set(op.targetId, updated as EffectiveDelivery)
      else next.soas.set(op.targetId, updated as EffectiveSoa)
      break
    }
    case 'soa.save': {
      const current = next.soas.get(op.soa.id)
      next.soas.set(op.soa.id, {
        ...op.soa,
        documentPath: current?.documentPath ?? null,
        ...(current?.localDocument ? { localDocument: current.localDocument } : {}),
        ...mark,
      })
      break
    }
    case 'soa.delete':
      next.soas.delete(op.id)
      break
    case 'repayment.save':
      next.repayments.set(op.repayment.id, { ...op.repayment, ...mark })
      break
    case 'repayment.delete':
      next.repayments.delete(op.id)
      break
    case 'price.save':
      next.prices.set(op.price.id, { ...op.price, ...mark })
      break
    case 'price.delete':
      next.prices.delete(op.id)
      break
  }
  return next
}

/** Applique les opérations en attente, dans l'ordre, par-dessus le miroir. */
export function applyOps(mirror: MirrorState, ops: readonly Op[]): MirrorState {
  return ops.reduce((state, op) => applyOp(state, op), mirror)
}

/** Libellé court d'une opération (détail de la file d'attente). */
export function describeOp(op: Op, formatDate: (date: IsoDate) => string = (d) => d): string {
  switch (op.kind) {
    case 'replacement.upsert':
      return 'Remplacement de bonbonne'
    case 'replacement.delete':
      return 'Suppression d’un remplacement'
    case 'delivery.save':
      return `Livraison du ${formatDate(op.delivery.deliveryDate)}`
    case 'delivery.delete':
      return 'Suppression d’une livraison'
    case 'document.attach':
      return op.target === 'delivery' ? 'Bon de livraison' : 'Document du SOA'
    case 'document.detach':
      return 'Retrait d’un document'
    case 'soa.save':
      return `SOA de ${op.soa.month}`
    case 'soa.delete':
      return 'Suppression d’un SOA'
    case 'repayment.save':
      return `Remboursement du ${formatDate(op.repayment.repaymentDate)}`
    case 'repayment.delete':
      return 'Suppression d’un remboursement'
    case 'price.save':
      return `Prix à partir du ${formatDate(op.price.effectiveFrom)}`
    case 'price.delete':
      return 'Suppression d’un prix'
  }
}
