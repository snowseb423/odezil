import { describe, expect, it } from 'vitest'
import {
  centsToInput,
  formatDate,
  formatDateLong,
  formatDateShort,
  formatMonth,
  formatRs,
  formatTime,
  formatTimestamp,
  parseRsToCents,
  plural,
} from './format.ts'

const NNBSP = '\u202F'
const NBSP = '\u00A0'

describe('montants « Rs 1 200,00 »', () => {
  it('toujours deux décimales, milliers séparés par une espace fine insécable', () => {
    expect(formatRs(120_000)).toBe(`Rs${NBSP}1${NNBSP}200,00`)
    expect(formatRs(24_000)).toBe(`Rs${NBSP}240,00`)
    expect(formatRs(123_456_789)).toBe(`Rs${NBSP}1${NNBSP}234${NNBSP}567,89`)
    expect(formatRs(5)).toBe(`Rs${NBSP}0,05`)
    expect(formatRs(0)).toBe(`Rs${NBSP}0,00`)
  })

  it('signe les écarts avec le vrai signe moins', () => {
    expect(formatRs(-2_400)).toBe(`−Rs${NBSP}24,00`)
    expect(formatRs(1_001, { signed: true })).toBe(`+Rs${NBSP}10,01`)
    expect(formatRs(0, { signed: true })).toBe(`Rs${NBSP}0,00`)
  })

  it('lit les saisies en centimes sans flottant', () => {
    expect(parseRsToCents('240')).toBe(24_000)
    expect(parseRsToCents('240,5')).toBe(24_050)
    expect(parseRsToCents('1 200,50')).toBe(120_050)
    expect(parseRsToCents(`1${NNBSP}200,05`)).toBe(120_005)
    expect(parseRsToCents('Rs 240.10')).toBe(24_010)
    expect(parseRsToCents('0,1')).toBe(10)
    // 0,1 + 0,2 en flottant donnerait 0,30000000000000004
    expect(parseRsToCents('0,30')).toBe(30)
    expect(parseRsToCents('12,345')).toBeNull()
    expect(parseRsToCents('-5')).toBeNull()
    expect(parseRsToCents('abc')).toBeNull()
    expect(parseRsToCents('')).toBeNull()
  })

  it('reformate les centimes pour un champ de saisie', () => {
    expect(centsToInput(24_000)).toBe('240,00')
    expect(centsToInput(5)).toBe('0,05')
    expect(parseRsToCents(centsToInput(123_456))).toBe(123_456)
  })
})

describe('dates et heures en français, à Maurice', () => {
  it('écrit les dates', () => {
    expect(formatDateLong('2026-10-01')).toBe('jeudi 1er octobre 2026')
    expect(formatDate('2026-10-14')).toBe('14 octobre 2026')
    expect(formatDateShort('2026-12-25')).toBe('ven. 25 déc.')
    expect(formatMonth('2027-08')).toBe('août 2027')
  })

  it('affiche les heures à l’heure de Maurice', () => {
    expect(formatTime('2026-10-14T21:05:00Z')).toBe('01h05')
    expect(formatTimestamp('2026-10-14T10:32:00Z')).toBe('mer. 14/10 à 14h32')
    expect(formatTimestamp('2026-10-14T21:05:00Z')).toBe('jeu. 15/10 à 01h05')
  })

  it('accorde les pluriels', () => {
    expect(plural(0, 'bonbonne')).toBe('0 bonbonne')
    expect(plural(1, 'bonbonne')).toBe('1 bonbonne')
    expect(plural(3, 'bonbonne')).toBe('3 bonbonnes')
  })
})
