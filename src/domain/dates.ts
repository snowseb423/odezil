// Calendrier sur des dates ISO « AAAA-MM-JJ » manipulées en UTC : les
// calculs de jours ne dépendent jamais du fuseau de l'appareil. Seule
// « aujourd'hui » dépend de l'heure, évaluée à Maurice.
import type { IsoDate, IsoMonth } from './types.ts'

export const MAURITIUS_TZ = 'Indian/Mauritius'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_MONTH = /^(\d{4})-(\d{2})$/
const DAY_MS = 86_400_000

function toUtcMs(date: IsoDate): number {
  const match = ISO_DATE.exec(date)
  if (!match) throw new RangeError(`Date ISO invalide : ${date}`)
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10)
}

function monthParts(month: IsoMonth): [number, number] {
  const match = ISO_MONTH.exec(month)
  if (!match) throw new RangeError(`Mois ISO invalide : ${month}`)
  return [Number(match[1]), Number(match[2])]
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const probe = new Date(toUtcMs(value))
  return (
    probe.getUTCFullYear() === Number(match[1]) &&
    probe.getUTCMonth() === Number(match[2]) - 1 &&
    probe.getUTCDate() === Number(match[3])
  )
}

export function isoDate(year: number, month: number, day: number): IsoDate {
  return fromUtcMs(Date.UTC(year, month - 1, day))
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(toUtcMs(date)).getUTCDay()
  return day === 0 ? 7 : day
}

export function isWeekend(date: IsoDate): boolean {
  return isoWeekday(date) >= 6
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS)
}

/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS)
}

/** Toutes les dates de `start` à `end`, bornes incluses. */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const days: IsoDate[] = []
  for (let ms = toUtcMs(start), last = toUtcMs(end); ms <= last; ms += DAY_MS) {
    days.push(fromUtcMs(ms))
  }
  return days
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b
}

export function clampDate(date: IsoDate, min: IsoDate, max: IsoDate): IsoDate {
  return maxDate(min, minDate(date, max))
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7)
}

export function firstDayOfMonth(month: IsoMonth): IsoDate {
  monthParts(month)
  return `${month}-01`
}

export function lastDayOfMonth(month: IsoMonth): IsoDate {
  const [year, m] = monthParts(month)
  return fromUtcMs(Date.UTC(year, m, 0))
}

export function addMonths(month: IsoMonth, count: number): IsoMonth {
  const [year, m] = monthParts(month)
  return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7)
}

/** Tous les mois de `from` à `to`, bornes incluses. */
export function eachMonth(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const months: IsoMonth[] = []
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month)
  return months
}

/** Lundi de la semaine contenant `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date))
}

/** Les 7 jours (lundi → dimanche) de la semaine contenant `date`. */
export function weekOf(date: IsoDate): IsoDate[] {
  const monday = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

function zonedParts(now: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return values
}

/** Date du jour dans le fuseau donné (Maurice par défaut). */
export function todayIn(timeZone: string = MAURITIUS_TZ, now: Date = new Date()): IsoDate {
  const p = zonedParts(now, timeZone)
  return isoDate(p.year!, p.month!, p.day!)
}

/** Millisecondes jusqu'au prochain minuit dans le fuseau donné. */
export function msUntilNextMidnight(timeZone: string = MAURITIUS_TZ, now: Date = new Date()): number {
  const p = zonedParts(now, timeZone)
  const elapsed = ((p.hour! * 60 + p.minute!) * 60 + p.second!) * 1000 + now.getMilliseconds()
  return DAY_MS - elapsed
}

// ---- Horodatages à Maurice ----

/** Décalage fixe de Maurice : UTC+4, sans heure d'été depuis 2009. */
export const MAURITIUS_OFFSET = '+04:00'

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

function parseTimestamp(timestamp: string): Date {
  const moment = new Date(timestamp)
  if (Number.isNaN(moment.getTime())) throw new RangeError(`Horodatage invalide : ${timestamp}`)
  return moment
}

/** Jour à Maurice d'un horodatage (et non le jour UTC ni celui de l'appareil). */
export function mauritiusDateOf(timestamp: string): IsoDate {
  return todayIn(MAURITIUS_TZ, parseTimestamp(timestamp))
}

/** Heure « HH:MM » à Maurice d'un horodatage. */
export function mauritiusTimeOf(timestamp: string): string {
  const p = zonedParts(parseTimestamp(timestamp), MAURITIUS_TZ)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Date et heure saisies à Maurice (« 2026-10-15 », « 01:30 ») → horodatage ISO en UTC. */
export function mauritiusLocalToIso(date: IsoDate, time: string): string {
  if (!isIsoDate(date) || !TIME.test(time)) throw new RangeError(`Date ou heure invalide : ${date} ${time}`)
  return new Date(`${date}T${time}:00${MAURITIUS_OFFSET}`).toISOString()
}

export function isTime(value: string): boolean {
  return TIME.test(value)
}
