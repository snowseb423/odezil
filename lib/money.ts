/**
 * Montants en centimes de roupie (entiers). Jamais de flottants pour les calculs :
 * conversion uniquement aux bords (saisie → parseRsToCents, affichage → formatRs).
 */

/** Plus grand montant stockable (type SQL `integer`). */
export const MAX_CENTS = 2_147_483_647;

const NBSP = " ";

export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: number, label = "montant"): number {
  if (!isCents(value)) {
    throw new TypeError(`${label} doit être un entier de centimes (reçu : ${String(value)})`);
  }
  return value;
}

/** Somme exacte de montants en centimes. */
export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += assertCents(value);
  }
  return assertCents(total, "total");
}

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Partie numérique « 1 200,00 » (espaces insécables), sans préfixe ni signe. */
function formatAbsolute(cents: number, thousandsSeparator: string): string {
  const abs = Math.abs(assertCents(cents));
  const units = Math.trunc(abs / 100);
  const fraction = abs % 100;
  return `${groupThousands(String(units), thousandsSeparator)},${String(fraction).padStart(2, "0")}`;
}

/**
 * Format d'affichage : `Rs 1 200,00` (espaces insécables, 2 décimales).
 * Négatif : `-Rs 1 200,00`.
 */
export function formatRs(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}Rs${NBSP}${formatAbsolute(cents, NBSP)}`;
}

/** Montant signé explicitement (`+Rs 12,00` / `-Rs 12,00` / `Rs 0,00`), pour les écarts. */
export function formatRsSigned(cents: number): string {
  if (cents > 0) return `+${formatRs(cents)}`;
  return formatRs(cents);
}

/** Nombre décimal sans séparateur de milliers, virgule décimale (`-1200,50`), pour le CSV. */
export function formatCentsDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${formatAbsolute(cents, "")}`;
}

/** Valeur pour un champ de saisie (`1200,50`, ou `1200` si pas de centimes). */
export function centsToInputValue(cents: number): string {
  assertCents(cents);
  return cents % 100 === 0 ? String(cents / 100) : formatCentsDecimal(cents);
}

/**
 * Convertit une saisie en centimes, sans passer par les flottants.
 * Accepte : `240`, `240,5`, `240.50`, `1 200,00`, `Rs 1 200`.
 * Refuse : négatifs, plus de 2 décimales, séparateurs multiples, valeurs > MAX_CENTS.
 * Renvoie `null` si la saisie est invalide.
 */
export function parseRsToCents(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/^rs\.?/i, "")
    .replace(/[\s  ]/g, "");
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const [, units = "", fraction = ""] = match;
  const unitsTrimmed = units.replace(/^0+(?=\d)/, "");
  if (unitsTrimmed.length > 10) return null;
  const cents = Number(unitsTrimmed) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}
