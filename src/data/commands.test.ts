import { describe, expect, it } from 'vitest'
import type { Delivery, Price, Replacement, SoaStatement } from '../domain/types.ts'
import {
  CommandError,
  addReplacementOp,
  attachDocumentOp,
  deletePriceOp,
  deleteReplacementOp,
  documentPath,
  editReplacementOp,
  saveDeliveryOp,
  savePriceOp,
  saveRepaymentOp,
  saveSoaOp,
  updateDeliveryNoteOp,
} from './commands.ts'
import { fitWithin, isPdf } from './documents.ts'
import { applyOps, emptyMirror } from './ops.ts'

const PRICES: Price[] = [{ id: 'p0', unitPriceCents: 24_000, effectiveFrom: '2000-01-01' }]
const iso = (mauritius: string) => new Date(`${mauritius.replace(' ', 'T')}:00+04:00`).toISOString()

function replacement(id: string, mauritius: string, deliveryId: string | null = null): Replacement {
  return { id, replacedAt: iso(mauritius), note: null, deliveryId }
}

const DELIVERY: Delivery = {
  id: 'd1',
  deliveryDate: '2026-10-14',
  bottlesTotal: 5,
  bottlesF1: 2,
  unitPriceCentsApplied: 24_000,
  documentPath: null,
  note: null,
}

function data(overrides: Partial<{ replacements: Replacement[]; deliveries: Delivery[]; soas: SoaStatement[]; prices: Price[] }> = {}) {
  return { prices: PRICES, replacements: [], deliveries: [], soas: [], ...overrides }
}

describe('remplacements', () => {
  const now = new Date('2026-10-14T10:00:00Z') // 14 h à Maurice

  it('ajoute un oubli à la date et l’heure de Maurice, jamais dans le futur', () => {
    const op = addReplacementOp({ date: '2026-10-12', time: '07:30', note: '  oubli ' }, now, 'x')
    expect(op).toEqual({ kind: 'replacement.upsert', replacement: { id: 'x', replacedAt: '2026-10-12T03:30:00.000Z', note: 'oubli' } })
    expect(() => addReplacementOp({ date: '2026-10-14', time: '15:00' }, now)).toThrow(/futur/)
    expect(() => addReplacementOp({ date: '2026-02-30', time: '15:00' }, now)).toThrow(CommandError)
  })

  it('un remplacement rattaché est verrouillé : ni modification ni suppression', () => {
    const locked = replacement('r1', '2026-10-03 08:00', 'd1')
    expect(() => editReplacementOp(locked, { date: '2026-10-03', time: '09:00' }, now)).toThrow(/rattaché/)
    expect(() => deleteReplacementOp(locked)).toThrow(/rattaché/)
    const free = replacement('r2', '2026-10-03 08:00')
    expect(deleteReplacementOp(free)).toEqual({ kind: 'replacement.delete', id: 'r2' })
  })
})

describe('livraisons', () => {
  it('rattache les remplacements attribués et fige le prix estimé', () => {
    const replacements = [replacement('a', '2026-10-01 08:00'), replacement('b', '2026-10-15 08:00')]
    const { op, preview } = saveDeliveryOp(data({ replacements }), { deliveryDate: '2026-10-14', bottlesTotal: 4, note: '' }, { id: 'd9' })
    expect(op).toEqual({
      kind: 'delivery.save',
      delivery: { id: 'd9', deliveryDate: '2026-10-14', bottlesTotal: 4, note: null },
      replacementIds: ['a'],
      unitPriceCents: 24_000,
    })
    expect(preview.after).toMatchObject({ bottlesF1: 1, bottlesF2: 3, f2Cents: 72_000 })
  })

  it('exige une confirmation quand aucun remplacement n’est enregistré', () => {
    expect(() => saveDeliveryOp(data(), { deliveryDate: '2026-10-14', bottlesTotal: 2 })).toThrow(/confirmez/)
    const { op } = saveDeliveryOp(data(), { deliveryDate: '2026-10-14', bottlesTotal: 2 }, { confirmed: true })
    expect(op.kind === 'delivery.save' && op.replacementIds).toEqual([])
  })

  it('refuse un total invalide ou une date sans prix', () => {
    expect(() => saveDeliveryOp(data(), { deliveryDate: '2026-10-14', bottlesTotal: 0 }, { confirmed: true })).toThrow(CommandError)
    expect(() => saveDeliveryOp(data({ prices: [] }), { deliveryDate: '2026-10-14', bottlesTotal: 1 }, { confirmed: true })).toThrow(/prix/)
  })

  it('modifier la note ne recalcule pas la répartition', () => {
    const replacements = [
      replacement('a', '2026-10-01 08:00', 'd1'),
      replacement('b', '2026-10-02 08:00', 'd1'),
      replacement('c', '2026-10-03 08:00'), // oubli enregistré après coup
    ]
    expect(updateDeliveryNoteOp({ replacements }, DELIVERY, 'livreur en retard')).toEqual({
      kind: 'delivery.save',
      delivery: { id: 'd1', deliveryDate: '2026-10-14', bottlesTotal: 5, note: 'livreur en retard' },
      replacementIds: ['a', 'b'],
      unitPriceCents: 24_000,
    })
  })

  it('l’état affiché applique la livraison et ses rattachements ensemble', () => {
    const replacements = [replacement('a', '2026-10-01 08:00'), replacement('b', '2026-10-02 08:00')]
    const mirror = emptyMirror()
    for (const r of replacements) mirror.replacements.set(r.id, r)
    const { op } = saveDeliveryOp(data({ replacements }), { deliveryDate: '2026-10-14', bottlesTotal: 1 }, { id: 'd1' })
    const state = applyOps(mirror, [op])
    expect(state.deliveries.get('d1')).toMatchObject({ bottlesF1: 1, pending: true })
    expect([...state.replacements.values()].map((r) => r.deliveryId)).toEqual(['d1', null])
    // Le miroir d'origine n'est pas modifié (fonction pure).
    expect([...mirror.replacements.values()].map((r) => r.deliveryId)).toEqual([null, null])
  })
})

describe('SOA', () => {
  const deliveries = [DELIVERY] // attendu d'octobre : 5 × 240 = 1 200
  const base = { month: '2026-10', varianceTreatment: 'pending' as const }

  it('calcule et fige l’écart', () => {
    const op = saveSoaOp(data({ deliveries }), { ...base, totalBilledCents: 120_000 }, { id: 's1' })
    expect(op).toEqual({
      kind: 'soa.save',
      soa: { id: 's1', month: '2026-10', totalBilledCents: 120_000, varianceCents: 0, varianceTreatment: 'pending', note: null },
    })
  })

  it('bloque un écart non nul sans traitement, sauf « en attente » explicite', () => {
    expect(() => saveSoaOp(data({ deliveries }), { ...base, totalBilledCents: 124_800 })).toThrow(/traitement/)
    const pending = saveSoaOp(data({ deliveries }), { ...base, totalBilledCents: 124_800 }, { allowPending: true })
    expect(pending.kind === 'soa.save' && pending.soa).toMatchObject({ varianceCents: 4_800, varianceTreatment: 'pending' })
    const split = saveSoaOp(data({ deliveries }), { ...base, totalBilledCents: 115_200, varianceTreatment: 'split_50_50' })
    expect(split.kind === 'soa.save' && split.soa).toMatchObject({ varianceCents: -4_800, varianceTreatment: 'split_50_50' })
  })

  it('un seul SOA par mois', () => {
    const existing: SoaStatement = { id: 's1', ...base, totalBilledCents: 0, varianceCents: 0, documentPath: null, note: null }
    expect(() => saveSoaOp(data({ soas: [existing] }), { ...base, totalBilledCents: 0 })).toThrow(/existe déjà/)
    expect(saveSoaOp(data({ soas: [existing] }), { ...base, totalBilledCents: 0 }, { existing }).kind).toBe('soa.save')
  })
})

describe('remboursements et prix', () => {
  it('accepte un remboursement partiel ou groupé, jamais nul ou négatif', () => {
    expect(saveRepaymentOp({ repaymentDate: '2026-10-20', amountCents: 1 }, null, 'x')).toMatchObject({ repayment: { amountCents: 1 } })
    expect(() => saveRepaymentOp({ repaymentDate: '2026-10-20', amountCents: 0 })).toThrow(CommandError)
    expect(() => saveRepaymentOp({ repaymentDate: '2026-10-20', amountCents: 10.5 })).toThrow(CommandError)
  })

  it('ajoute un prix avec date d’effet ; le premier prix ne se supprime pas', () => {
    const prices = [...PRICES, { id: 'p1', unitPriceCents: 25_000, effectiveFrom: '2026-11-01' }]
    expect(savePriceOp({ prices }, { unitPriceCents: 26_000, effectiveFrom: '2027-01-01' }, null, 'p2')).toEqual({
      kind: 'price.save',
      price: { id: 'p2', unitPriceCents: 26_000, effectiveFrom: '2027-01-01' },
    })
    expect(() => savePriceOp({ prices }, { unitPriceCents: 26_000, effectiveFrom: '2026-11-01' })).toThrow(/existe déjà/)
    expect(() => deletePriceOp({ prices }, PRICES[0]!)).toThrow(/premier prix/)
    expect(deletePriceOp({ prices }, prices[1]!)).toEqual({ kind: 'price.delete', id: 'p1' })
  })
})

describe('documents', () => {
  it('range les documents dans les dossiers du bucket', () => {
    expect(documentPath('delivery', { id: 'd1' }, 'doc', 'jpg')).toBe('deliveries/d1/doc.jpg')
    expect(documentPath('soa', { month: '2026-10' }, 'doc', 'pdf')).toBe('soa/2026-10/doc.pdf')
    const soa: SoaStatement = { id: 's1', month: '2026-10', totalBilledCents: 0, varianceCents: 0, varianceTreatment: 'pending', documentPath: 'soa/2026-10/old.pdf', note: null }
    const op = attachDocumentOp('soa', soa, { blob: new Blob(['x']), contentType: 'application/pdf', extension: 'pdf' }, 'new')
    expect(op).toMatchObject({ path: 'soa/2026-10/new.pdf', previousPath: 'soa/2026-10/old.pdf', targetId: 's1' })
  })

  it('réduit les photos à 1600 px de côté long, sans jamais agrandir', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('reconnaît un PDF, même sans type MIME', () => {
    expect(isPdf({ type: 'application/pdf', name: 'soa' })).toBe(true)
    expect(isPdf({ type: '', name: 'SOA-octobre.PDF' })).toBe(true)
    expect(isPdf({ type: 'image/jpeg', name: 'bon.jpg' })).toBe(false)
  })
})
