/**
 * Dates métier : chaînes `YYYY-MM-DD` (type SQL `date`) et mois `YYYY-MM`.
 * Pas d'objet Date dans la logique métier, pour éviter tout décalage de fuseau.
 */

export const APP_TIME_ZONE = "Indian/Mauritius";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function isMonthKey(value: string): boolean {
  const match = MONTH_KEY.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date du jour à Maurice (`YYYY-MM-DD`). */
export function todayIso(now: Date = new Date()): string {
  // en-CA formate en YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `2026-09-14` → `2026-09`. */
export function monthKeyOf(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Date invalide : ${isoDate}`);
  return isoDate.slice(0, 7);
}

/** `2026-09` → `2026-09-01` (colonne SQL soa_statements.month). */
export function monthStartDate(monthKey: string): string {
  if (!isMonthKey(monthKey)) throw new RangeError(`Mois invalide : ${monthKey}`);
  return `${monthKey}-01`;
}

/** Décale un mois de `delta` mois : `addMonths("2026-01", -1)` → `2025-12`. */
export function addMonths(monthKey: string, delta: number): string {
  if (!isMonthKey(monthKey)) throw new RangeError(`Mois invalide : ${monthKey}`);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const index = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}`;
}

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/** `2026-09` → `septembre 2026`. */
export function formatMonthFr(monthKey: string): string {
  if (!isMonthKey(monthKey)) throw new RangeError(`Mois invalide : ${monthKey}`);
  return `${MONTHS_FR[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
}

/** `2026-09` → `Septembre 2026`. */
export function formatMonthFrCapitalized(monthKey: string): string {
  const label = formatMonthFr(monthKey);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** `2026-09-02` → `2 septembre 2026`. */
export function formatDateFr(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Date invalide : ${isoDate}`);
  const day = Number(isoDate.slice(8, 10));
  return `${day === 1 ? "1er" : day} ${formatMonthFr(isoDate.slice(0, 7))}`;
}

/** `2026-09-02` → `02/09/2026` (format court, CSV et listes compactes). */
export function formatDateShortFr(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new RangeError(`Date invalide : ${isoDate}`);
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}
