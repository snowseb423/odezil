/** Messages de confirmation affichés sur l'accueil après une action (`/?ok=<clé>`). */
const NOTICES = {
  livraison: "Livraison enregistrée.",
  soa: "Relevé SOA enregistré.",
  remboursement: "Remboursement enregistré.",
} as const;

/** Message pour `?ok=…`, ou `undefined` (clés inconnues, `__proto__`, `constructor`…). */
export function noticeFor(ok: string | string[] | undefined): string | undefined {
  return typeof ok === "string" && Object.hasOwn(NOTICES, ok) ? NOTICES[ok as keyof typeof NOTICES] : undefined;
}
