// Intentions de l'utilisateur → opérations validées, prêtes à être mises en
// file (engine.commit). Fonctions pures, testées : elles appliquent les
// règles du domaine (attribution, verrou, prix figé, un SOA par mois).
import { type DeliveryEditPreview, isLocked, monthVarianceCents, expectedMonthCents, previewDelivery } from '../domain/calculations.ts'
import { isIsoDate, mauritiusLocalToIso } from '../domain/dates.ts'
import type { Cents, Delivery, IsoDate, IsoMonth, Price, Replacement, Repayment, SoaStatement, VarianceTreatment } from '../domain/types.ts'
import type { AppData } from './mirror.ts'
import type { DocumentTarget, Op } from './ops.ts'

/** Saisie refusée : le message est affiché tel quel. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

export function newId(): string {
  return crypto.randomUUID()
}

const NOTE_MAX = 500

export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim()
  if (trimmed.length > NOTE_MAX) throw new CommandError(`Note trop longue (${NOTE_MAX} caractères au plus).`)
  return trimmed || null
}

type Data = Pick<AppData, 'prices' | 'replacements' | 'deliveries' | 'soas'>

// ---------------------------------------------------------------------
// Remplacements
// ---------------------------------------------------------------------

/** « Bonbonne remplacée » : un remplacement à l'instant. */
export function recordReplacementOp(now: Date = new Date(), id: string = newId()): Op {
  return { kind: 'replacement.upsert', replacement: { id, replacedAt: now.toISOString(), note: null } }
}

/** Remplacement oublié, à une date et une heure de Maurice (jamais dans le futur). */
export function addReplacementOp(input: { date: IsoDate; time: string; note?: string | null }, now: Date = new Date(), id: string = newId()): Op {
  return { kind: 'replacement.upsert', replacement: { id, replacedAt: pastTimestamp(input.date, input.time, now), note: cleanNote(input.note) } }
}

export function editReplacementOp(replacement: Replacement, input: { date: IsoDate; time: string; note?: string | null }, now: Date = new Date()): Op {
  if (isLocked(replacement)) throw new CommandError('Ce remplacement est rattaché à une livraison : recalculez ou supprimez la livraison pour le modifier.')
  return {
    kind: 'replacement.upsert',
    replacement: { id: replacement.id, replacedAt: pastTimestamp(input.date, input.time, now), note: cleanNote(input.note) },
  }
}

export function deleteReplacementOp(replacement: Replacement): Op {
  if (isLocked(replacement)) throw new CommandError('Ce remplacement est rattaché à une livraison : il ne peut pas être supprimé.')
  return { kind: 'replacement.delete', id: replacement.id }
}

function pastTimestamp(date: IsoDate, time: string, now: Date): string {
  let iso: string
  try {
    iso = mauritiusLocalToIso(date, time)
  } catch {
    throw new CommandError('Date ou heure invalide.')
  }
  if (Date.parse(iso) > now.getTime() + 60_000) throw new CommandError('La date et l’heure ne peuvent pas être dans le futur.')
  return iso
}

// ---------------------------------------------------------------------
// Livraisons
// ---------------------------------------------------------------------

export interface DeliveryDraft {
  deliveryDate: IsoDate
  bottlesTotal: number
  note?: string | null
}

/** Aperçu de la répartition (création, recalcul, modification de la date ou du total). */
export function deliveryPreview(data: Data, draft: DeliveryDraft, existing?: Delivery | null): DeliveryEditPreview | null {
  if (!isIsoDate(draft.deliveryDate) || !Number.isInteger(draft.bottlesTotal) || draft.bottlesTotal < 1) return null
  return previewDelivery({
    existing: existing ?? null,
    deliveryDate: draft.deliveryDate,
    bottlesTotal: draft.bottlesTotal,
    replacements: data.replacements,
    deliveries: data.deliveries,
    prices: data.prices,
  })
}

/**
 * Création ou recalcul d'une livraison : l'attribution est calculée ici,
 * sur l'état affiché, puis envoyée en une seule opération atomique.
 */
export function saveDeliveryOp(
  data: Data,
  draft: DeliveryDraft,
  options: { existing?: Delivery | null; confirmed?: boolean; id?: string } = {},
): { op: Op; preview: DeliveryEditPreview } {
  if (!isIsoDate(draft.deliveryDate)) throw new CommandError('Date de livraison invalide.')
  if (!Number.isInteger(draft.bottlesTotal) || draft.bottlesTotal < 1 || draft.bottlesTotal > 1000) {
    throw new CommandError('Le nombre de bonbonnes doit être compris entre 1 et 1 000.')
  }
  const preview = deliveryPreview(data, draft, options.existing)
  if (!preview) throw new CommandError('Aucun prix unitaire n’est en vigueur à cette date.')
  if (preview.allocation.requiresConfirmation && !options.confirmed) {
    throw new CommandError('Aucun remplacement enregistré pour le Foyer 1 : confirmez que toutes les bonbonnes vont au Foyer 2.')
  }
  const id = options.existing?.id ?? options.id ?? newId()
  return {
    op: {
      kind: 'delivery.save',
      delivery: { id, deliveryDate: draft.deliveryDate, bottlesTotal: draft.bottlesTotal, note: cleanNote(draft.note) },
      replacementIds: preview.allocation.attachedIds,
      unitPriceCents: preview.after.unitPriceCents,
    },
    preview,
  }
}

/** Modification de la note seule : la répartition ne change pas. */
export function updateDeliveryNoteOp(data: Pick<AppData, 'replacements'>, delivery: Delivery, note: string | null): Op {
  return {
    kind: 'delivery.save',
    delivery: { id: delivery.id, deliveryDate: delivery.deliveryDate, bottlesTotal: delivery.bottlesTotal, note: cleanNote(note) },
    replacementIds: data.replacements.filter((r) => r.deliveryId === delivery.id).map((r) => r.id),
    unitPriceCents: delivery.unitPriceCentsApplied,
  }
}

/** Suppression : ses remplacements repassent en attente, son bon est supprimé. */
export function deleteDeliveryOp(delivery: Delivery): Op {
  return { kind: 'delivery.delete', id: delivery.id, documentPath: delivery.documentPath }
}

// ---------------------------------------------------------------------
// Documents (bons de livraison et SOA)
// ---------------------------------------------------------------------

export type DocumentExtension = 'jpg' | 'png' | 'webp' | 'pdf'

export interface PreparedDocument {
  blob: Blob
  contentType: string
  extension: DocumentExtension
}

export function documentPath(target: DocumentTarget, owner: { id: string } | { month: IsoMonth }, documentId: string, extension: DocumentExtension): string {
  if (target === 'delivery' && 'id' in owner) return `deliveries/${owner.id}/${documentId}.${extension}`
  if (target === 'soa' && 'month' in owner) return `soa/${owner.month}/${documentId}.${extension}`
  throw new CommandError('Document sans destination.')
}

export function attachDocumentOp(
  target: DocumentTarget,
  entity: Pick<Delivery, 'id' | 'documentPath'> | Pick<SoaStatement, 'id' | 'month' | 'documentPath'>,
  document: PreparedDocument,
  documentId: string = newId(),
): Op {
  const owner = target === 'soa' && 'month' in entity ? { month: entity.month } : { id: entity.id }
  return {
    kind: 'document.attach',
    target,
    targetId: entity.id,
    path: documentPath(target, owner, documentId, document.extension),
    blob: document.blob,
    contentType: document.contentType,
    previousPath: entity.documentPath,
  }
}

export function detachDocumentOp(target: DocumentTarget, entity: { id: string; documentPath: string | null }): Op {
  if (!entity.documentPath) throw new CommandError('Aucun document à retirer.')
  return { kind: 'document.detach', target, targetId: entity.id, path: entity.documentPath }
}

// ---------------------------------------------------------------------
// SOA
// ---------------------------------------------------------------------

export interface SoaDraft {
  month: IsoMonth
  totalBilledCents: Cents
  varianceTreatment: VarianceTreatment
  note?: string | null
}

/** Total attendu et écart d'un mois, d'après les livraisons affichées. */
export function soaFigures(data: Pick<AppData, 'deliveries'>, month: IsoMonth, totalBilledCents: Cents): { expectedCents: Cents; varianceCents: Cents } {
  const expectedCents = expectedMonthCents(data.deliveries, month)
  return { expectedCents, varianceCents: monthVarianceCents(totalBilledCents, expectedCents) }
}

export function saveSoaOp(
  data: Data,
  draft: SoaDraft,
  options: { existing?: SoaStatement | null; allowPending?: boolean; id?: string } = {},
): Op {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.month)) throw new CommandError('Mois invalide.')
  if (!Number.isSafeInteger(draft.totalBilledCents) || draft.totalBilledCents < 0) throw new CommandError('Montant du SOA invalide.')
  const other = data.soas.find((soa) => soa.month === draft.month && soa.id !== options.existing?.id)
  if (other) throw new CommandError('Un SOA existe déjà pour ce mois : modifiez-le.')
  const { varianceCents } = soaFigures(data, draft.month, draft.totalBilledCents)
  const treatment: VarianceTreatment = varianceCents === 0 ? 'pending' : draft.varianceTreatment
  if (varianceCents !== 0 && treatment === 'pending' && !options.allowPending) {
    throw new CommandError('Écart non nul : choisissez son traitement, ou laissez-le explicitement en attente.')
  }
  return {
    kind: 'soa.save',
    soa: {
      id: options.existing?.id ?? options.id ?? newId(),
      month: draft.month,
      totalBilledCents: draft.totalBilledCents,
      varianceCents,
      varianceTreatment: treatment,
      note: cleanNote(draft.note),
    },
  }
}

export function deleteSoaOp(soa: SoaStatement): Op {
  return { kind: 'soa.delete', id: soa.id, documentPath: soa.documentPath }
}

// ---------------------------------------------------------------------
// Remboursements et prix
// ---------------------------------------------------------------------

export function saveRepaymentOp(input: { repaymentDate: IsoDate; amountCents: Cents; note?: string | null }, existing?: Repayment | null, id: string = newId()): Op {
  if (!isIsoDate(input.repaymentDate)) throw new CommandError('Date invalide.')
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new CommandError('Le montant doit être supérieur à zéro.')
  return {
    kind: 'repayment.save',
    repayment: { id: existing?.id ?? id, repaymentDate: input.repaymentDate, amountCents: input.amountCents, note: cleanNote(input.note) },
  }
}

export function deleteRepaymentOp(repayment: Repayment): Op {
  return { kind: 'repayment.delete', id: repayment.id }
}

export function savePriceOp(data: Pick<AppData, 'prices'>, input: { unitPriceCents: Cents; effectiveFrom: IsoDate }, existing?: Price | null, id: string = newId()): Op {
  if (!isIsoDate(input.effectiveFrom)) throw new CommandError('Date d’effet invalide.')
  if (!Number.isSafeInteger(input.unitPriceCents) || input.unitPriceCents <= 0) throw new CommandError('Le prix doit être supérieur à zéro.')
  if (data.prices.some((p) => p.effectiveFrom === input.effectiveFrom && p.id !== existing?.id)) {
    throw new CommandError('Un prix existe déjà à cette date d’effet.')
  }
  const first = firstPrice(data.prices)
  if (existing && first?.id === existing.id && input.effectiveFrom > existing.effectiveFrom) {
    throw new CommandError('La date d’effet du premier prix ne peut pas être repoussée.')
  }
  return { kind: 'price.save', price: { id: existing?.id ?? id, unitPriceCents: input.unitPriceCents, effectiveFrom: input.effectiveFrom } }
}

export function deletePriceOp(data: Pick<AppData, 'prices'>, price: Price): Op {
  if (firstPrice(data.prices)?.id === price.id) throw new CommandError('Le premier prix ne peut pas être supprimé : modifiez-le.')
  return { kind: 'price.delete', id: price.id }
}

function firstPrice(prices: readonly Price[]): Price | null {
  return prices.reduce<Price | null>((first, p) => (!first || p.effectiveFrom < first.effectiveFrom ? p : first), null)
}
