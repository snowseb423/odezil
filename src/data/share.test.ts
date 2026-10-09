import { describe, expect, it } from 'vitest'
import { parseSharedView } from '../share/sharedView.ts'
import { base64url, generateShareToken, sha256Hex, shareUrl } from './share.ts'

describe('lien du Foyer 2', () => {
  it('token : 32 octets aléatoires en base64url, jamais deux fois le même', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateShareToken()))
    expect(tokens.size).toBe(50)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe('-__-')
  })

  it('hash SHA-256 hexadécimal identique à celui de la base', async () => {
    // Vecteur de référence (FIPS 180-2) ; la base renvoie le même (tests/sql).
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(generateShareToken())).toMatch(/^[0-9a-f]{64}$/)
    expect(shareUrl('https://eau.example/', 'abc')).toBe('https://eau.example/p/abc')
  })
})

describe('lecture de la vue partagée', () => {
  it('null pour un lien invalide', () => {
    expect(parseSharedView(null)).toBeNull()
  })

  it('ne garde que les champs attendus', () => {
    const view = parseSharedView({
      generated_at: '2026-10-14T05:00:00Z',
      deliveries: [{ date: '2026-10-14', bottles: 3, unit_price_cents: 24000, amount_cents: 72000, bottles_total: 99 }],
      months: [{ month: '2026-10', deliveries_cents: 72000, adjustment_cents: 500, total_cents: 72500 }],
      repayments: [{ date: '2026-10-20', amount_cents: 50000, note: 'privé' }],
      balance_cents: 22500,
    })
    expect(view).toEqual({
      generatedAt: '2026-10-14T05:00:00Z',
      deliveries: [{ date: '2026-10-14', bottles: 3, unitPriceCents: 24000, amountCents: 72000 }],
      months: [{ month: '2026-10', deliveriesCents: 72000, adjustmentCents: 500, totalCents: 72500 }],
      repayments: [{ date: '2026-10-20', amountCents: 50000 }],
      balanceCents: 22500,
    })
  })
})
