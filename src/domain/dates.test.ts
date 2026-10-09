import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  diffDays,
  eachMonth,
  isIsoDate,
  isoWeekday,
  lastDayOfMonth,
  mauritiusDateOf,
  mauritiusLocalToIso,
  mauritiusTimeOf,
  msUntilNextMidnight,
  startOfWeek,
  todayIn,
} from './dates.ts'

describe('calendrier', () => {
  it('calcule le jour ISO de la semaine', () => {
    expect(isoWeekday('2026-10-05')).toBe(1) // lundi
    expect(isoWeekday('2026-11-08')).toBe(7) // dimanche
  })

  it('valide les dates ISO', () => {
    expect(isIsoDate('2027-02-28')).toBe(true)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('28/02/2027')).toBe(false)
  })

  it('additionne jours et mois en franchissant les années', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(diffDays('2026-10-01', '2026-10-15')).toBe(14)
    expect(eachMonth('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
    expect(startOfWeek('2026-10-09')).toBe('2026-10-05')
  })
})

describe('heure de Maurice (UTC+4)', () => {
  it('« aujourd’hui » change à minuit à Maurice, pas à minuit UTC', () => {
    expect(todayIn('Indian/Mauritius', new Date('2026-10-14T19:59:59Z'))).toBe('2026-10-14')
    expect(todayIn('Indian/Mauritius', new Date('2026-10-14T20:00:00Z'))).toBe('2026-10-15')
    expect(msUntilNextMidnight('Indian/Mauritius', new Date('2026-10-14T19:00:00Z'))).toBe(3_600_000)
  })

  it('un remplacement à 01 h 00 à Maurice compte pour ce jour-là, pas pour la veille (UTC)', () => {
    expect(mauritiusDateOf('2026-10-14T21:00:00Z')).toBe('2026-10-15')
    expect(mauritiusDateOf('2026-10-14T21:00:00.000+00:00')).toBe('2026-10-15')
    expect(mauritiusDateOf('2026-10-15T01:00:00+04:00')).toBe('2026-10-15')
    expect(mauritiusDateOf('2026-10-14T19:59:00Z')).toBe('2026-10-14')
  })

  it('lit et écrit l’heure locale de Maurice', () => {
    expect(mauritiusTimeOf('2026-10-14T21:05:00Z')).toBe('01:05')
    expect(mauritiusLocalToIso('2026-10-15', '01:05')).toBe('2026-10-14T21:05:00.000Z')
    expect(mauritiusLocalToIso('2026-10-15', '23:59')).toBe('2026-10-15T19:59:00.000Z')
    expect(() => mauritiusLocalToIso('2026-02-30', '10:00')).toThrow(RangeError)
    expect(() => mauritiusLocalToIso('2026-10-15', '24:00')).toThrow(RangeError)
  })

  it('refuse un horodatage invalide', () => {
    expect(() => mauritiusDateOf('hier')).toThrow(RangeError)
  })
})
