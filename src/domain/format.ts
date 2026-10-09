// Mise en forme française, déterministe (indépendante de la version ICU
// du navigateur) : « Rs 1 200,00 », « −Rs 24,00 », « jeudi 1er octobre 2026 ».
import { isoWeekday, mauritiusDateOf, mauritiusTimeOf } from './dates.ts'
import type { Cents, IsoDate, IsoMonth } from './types.ts'

/** Espace fine insécable : séparateur de milliers. */
export const THIN_SPACE = '\u202F'
/** Espace insécable : entre « Rs » et le nombre. */
export const NBSP = '\u00A0'
/** Signe moins typographique. */
export const MINUS = '−'

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const WEEKDAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const MONTHS_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

/** « 12276 » → « 12 276 » (espace fine insécable). */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
}

/**
 * Montant en roupies à partir de centimes, toujours avec deux décimales :
 * « Rs 1 200,00 ». `signed` ajoute « + » devant un montant positif (écarts).
 */
export function formatRs(cents: Cents, options: { signed?: boolean } = {}): string {
  const rounded = Math.round(cents)
  const abs = Math.abs(rounded)
  const amount = `Rs${NBSP}${groupThousands(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, '0')}`
  if (rounded < 0) return `${MINUS}${amount}`
  if (rounded > 0 && options.signed) return `+${amount}`
  return amount
}

/** Centimes → valeur d'un champ de saisie (« 240,00 »). */
export function centsToInput(cents: Cents): string {
  const abs = Math.abs(Math.round(cents))
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Saisie d'un montant → centimes, sans passer par les flottants. Accepte
 * « 240 », « 1 200,50 », « 1200.5 », « Rs 240 » ; au plus deux décimales.
 * Renvoie null si la saisie est invalide ou négative.
 */
export function parseRsToCents(input: string): Cents | null {
  const normalized = input
    .replace(/^\s*rs\.?/i, '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(',', '.')
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(normalized)
  if (!match) return null
  const units = Number(match[1])
  const decimals = (match[2] ?? '').padEnd(2, '0')
  const cents = units * 100 + Number(decimals)
  return Number.isSafeInteger(cents) ? cents : null
}

export function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase('fr') + text.slice(1) : text
}

/** « 1 bonbonne », « 3 bonbonnes », « 0 bonbonne ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${Math.abs(count) >= 2 ? pluralForm : singular}`
}

function parts(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

function dayNumber(day: number): string {
  return day === 1 ? '1er' : String(day)
}

export function weekdayName(date: IsoDate): string {
  return WEEKDAYS[isoWeekday(date) - 1]!
}

export function weekdayShort(date: IsoDate): string {
  return WEEKDAYS_SHORT[isoWeekday(date) - 1]!
}

/** « jeudi 1er octobre 2026 ». */
export function formatDateLong(date: IsoDate): string {
  const { year, month, day } = parts(date)
  return `${weekdayName(date)} ${dayNumber(day)} ${MONTHS[month - 1]} ${year}`
}

/** « 1er octobre ». */
export function formatDayMonth(date: IsoDate): string {
  const { month, day } = parts(date)
  return `${dayNumber(day)} ${MONTHS[month - 1]}`
}

/** « 1er octobre 2026 ». */
export function formatDate(date: IsoDate): string {
  const { year } = parts(date)
  return `${formatDayMonth(date)} ${year}`
}

/** « jeu. 1er oct. ». */
export function formatDateShort(date: IsoDate): string {
  const { month, day } = parts(date)
  return `${weekdayShort(date)} ${dayNumber(day)} ${MONTHS_SHORT[month - 1]}`
}

/** « 01/10/2026 ». */
export function formatDateNumeric(date: IsoDate): string {
  const { year, month, day } = parts(date)
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

/** « octobre 2026 ». */
export function formatMonth(month: IsoMonth): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return `${MONTHS[m - 1]} ${year}`
}

/** Horodatage → « 14h32 », à l'heure de Maurice. */
export function formatTime(timestamp: string): string {
  return mauritiusTimeOf(timestamp).replace(':', 'h')
}

/** Horodatage → « lun. 28/09 à 14h32 », à l'heure de Maurice. */
export function formatTimestamp(timestamp: string): string {
  if (Number.isNaN(new Date(timestamp).getTime())) return ''
  const date = mauritiusDateOf(timestamp)
  const { month, day } = parts(date)
  return `${weekdayShort(date)} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')} à ${formatTime(timestamp)}`
}
